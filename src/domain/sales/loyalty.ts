import "server-only";
import { db, type DbOrTx, type Tx } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorize, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { big } from "@/lib/money";
import { todayISO } from "@/lib/dates";

/**
 * Loyalty points. Earned on the amount a customer actually pays (bill total less points redeemed), at
 * `earnPer100` points per ₹100. Redeemed at the counter as a tender worth `pointValuePaise` each: the invoice,
 * its taxable value and GST stay as billed, and the redeemed value is booked to "Loyalty points redeemed"
 * (an expense, like a discount allowed after tax). Nothing is accrued when points are earned. Returns and
 * voids take back earned points and give back redeemed ones in proportion. Points expire FIFO after
 * `expiryMonths` (0: never).
 */
export type LoyaltySettings = { enabled: boolean; earnPer100: number; pointValuePaise: number; minRedeem: number; expiryMonths: number; notify: boolean; template: string };
export const LOYALTY_DEFAULTS: LoyaltySettings = { enabled: false, earnPer100: 1, pointValuePaise: 100, minRedeem: 50, expiryMonths: 12, notify: false, template: "loyalty_points" };

export async function loyaltySettings(tenantId: string, q: DbOrTx = db): Promise<LoyaltySettings> {
  const t = await q.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true } });
  return { ...LOYALTY_DEFAULTS, ...((t.settings as { loyalty?: Partial<LoyaltySettings> }).loyalty ?? {}) };
}

export async function saveLoyaltySettings(ctx: Ctx, patch: Partial<LoyaltySettings>) {
  authorize(ctx, "integrations");
  const cur = await loyaltySettings(ctx.tenantId);
  const n = (v: unknown, lo: number, hi: number, msg: string) => { const x = Number(v); if (!(x >= lo && x <= hi)) throw new UserError(msg); return x; };
  const next: LoyaltySettings = {
    enabled: patch.enabled ?? cur.enabled,
    earnPer100: patch.earnPer100 !== undefined ? Math.round(n(patch.earnPer100, 0.01, 100, "Earn between 0.01 and 100 points per ₹100.") * 100) / 100 : cur.earnPer100,
    pointValuePaise: patch.pointValuePaise !== undefined ? Math.round(n(patch.pointValuePaise, 1, 10000, "A point is worth between 1 paisa and ₹100.")) : cur.pointValuePaise,
    minRedeem: patch.minRedeem !== undefined ? Math.round(n(patch.minRedeem, 1, 100000, "Minimum redemption is 1 to 100000 points.")) : cur.minRedeem,
    expiryMonths: patch.expiryMonths !== undefined ? Math.round(n(patch.expiryMonths, 0, 120, "Points expire after 0 (never) to 120 months.")) : cur.expiryMonths,
    notify: patch.notify ?? cur.notify,
    template: patch.template !== undefined ? (/^[a-z0-9_]{1,512}$/.test(patch.template) ? patch.template : (() => { throw new UserError("Template names are lowercase with underscores."); })()) : cur.template,
  };
  const t = await db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
  await db.tenant.update({ where: { id: ctx.tenantId }, data: { settings: { ...(t.settings as object), loyalty: next } } });
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Loyalty settings changed", entity: "tenant", before: cur, after: next,
    detail: `${next.enabled ? "on" : "off"} · ${next.earnPer100} pt per ₹100 · 1 pt = ₹${(next.pointValuePaise / 100).toFixed(2)} · min ${next.minRedeem} · expiry ${next.expiryMonths || "never"}${next.expiryMonths ? " months" : ""}` });
  return next;
}

export async function pointsBalance(q: DbOrTx, tenantId: string, customerId: string) {
  const r = await q.loyaltyLedger.aggregate({ where: { tenantId, customerId }, _sum: { points: true } });
  return r._sum.points ?? 0;
}

export async function pointsBalances(q: DbOrTx, tenantId: string) {
  const r = await q.loyaltyLedger.groupBy({ by: ["customerId"], where: { tenantId }, _sum: { points: true } });
  return new Map(r.map((x) => [x.customerId, x._sum.points ?? 0]));
}

export const pointsEarned = (paidPaise: number, s: LoyaltySettings) => Math.max(0, Math.floor((paidPaise * s.earnPer100) / 10000));
const expiry = (s: LoyaltySettings, from: Date) => (s.expiryMonths ? new Date(new Date(from).setMonth(from.getMonth() + s.expiryMonths)) : null);

/**
 * Checks a redemption inside the sale transaction (customer row locked) and returns its value in paise.
 * The value can't exceed the bill.
 */
export async function checkRedemption(tx: Tx, ctx: Ctx, customerId: string | null, points: number, billPaise: number) {
  const s = await loyaltySettings(ctx.tenantId, tx);
  if (!s.enabled) throw new UserError("Loyalty points aren’t turned on.");
  if (!customerId) throw new UserError("Select the customer to redeem their points.");
  if (points < s.minRedeem) throw new UserError(`Redeem at least ${s.minRedeem} points.`);
  await tx.$queryRaw`SELECT id FROM "Customer" WHERE id = ${customerId} AND "tenantId" = ${ctx.tenantId} FOR UPDATE`;
  const bal = await pointsBalance(tx, ctx.tenantId, customerId);
  if (points > bal) throw new UserError(`Only ${bal} points available.`);
  const value = points * s.pointValuePaise;
  if (value > billPaise) throw new UserError(`${points} points are worth more than the bill. Redeem up to ${Math.floor(billPaise / s.pointValuePaise)}.`);
  return { value, settings: s };
}

/** Records the sale's redemption and the points it earns on the amount paid. Returns points earned. */
export async function recordSalePoints(tx: Tx, ctx: Ctx, sale: { id: string; invoiceNo: string; customerId: string; at: Date }, paidPaise: number, redeem?: { points: number; value: number }) {
  const s = await loyaltySettings(ctx.tenantId, tx);
  if (!s.enabled && !redeem) return 0;
  const rows = [];
  if (redeem) rows.push({ tenantId: ctx.tenantId, customerId: sale.customerId, kind: "redeem", points: -redeem.points, valuePaise: BigInt(redeem.value), saleId: sale.id, note: sale.invoiceNo, userId: ctx.userId, at: sale.at });
  const earned = s.enabled ? pointsEarned(paidPaise, s) : 0;
  if (earned) rows.push({ tenantId: ctx.tenantId, customerId: sale.customerId, kind: "earn", points: earned, saleId: sale.id, note: sale.invoiceNo, userId: ctx.userId, at: sale.at, expiresAt: expiry(s, sale.at) });
  if (rows.length) await tx.loyaltyLedger.createMany({ data: rows });
  return earned;
}

const sum = (rows: { kind: string; points: number; valuePaise: bigint }[], kind: string) => rows.filter((r) => r.kind === kind).reduce((a, r) => ({ pts: a.pts + Math.abs(r.points), val: a.val + big(r.valuePaise) }), { pts: 0, val: 0 });

/**
 * Adjusts points for returned goods: of everything returned on the sale so far (`returnedPaise` of
 * `basePaise`), the same share of earned points is taken back and of redeemed points given back. Returns the
 * value of points given back, which the refund pays in points instead of money.
 */
export async function adjustPointsForReturn(tx: Tx, ctx: Ctx, sale: { id: string; customerId: string | null }, returnId: string, note: string, returnedPaise: number, basePaise: number) {
  if (!sale.customerId || basePaise <= 0) return { restoredValue: 0, reversed: 0, restored: 0 };
  const rows = await tx.loyaltyLedger.findMany({ where: { tenantId: ctx.tenantId, saleId: sale.id } });
  if (!rows.length) return { restoredValue: 0, reversed: 0, restored: 0 };
  const share = Math.min(1, returnedPaise / basePaise);
  const earned = sum(rows, "earn"), reversed = sum(rows, "reverse"), redeemed = sum(rows, "redeem"), restored = sum(rows, "restore");
  const rev = Math.floor(earned.pts * share) - reversed.pts;
  const back = Math.floor(redeemed.pts * share) - restored.pts;
  const backValue = share >= 1 ? redeemed.val - restored.val : Math.round(redeemed.val * share) - restored.val;
  const s = await loyaltySettings(ctx.tenantId, tx);
  const now = new Date();
  const data = [
    ...(rev > 0 ? [{ tenantId: ctx.tenantId, customerId: sale.customerId, kind: "reverse", points: -rev, saleId: sale.id, returnId, note, userId: ctx.userId }] : []),
    ...(back > 0 || backValue > 0 ? [{ tenantId: ctx.tenantId, customerId: sale.customerId, kind: "restore", points: Math.max(0, back), valuePaise: BigInt(Math.max(0, backValue)), saleId: sale.id, returnId, note, userId: ctx.userId, expiresAt: expiry(s, now) }] : []),
  ];
  if (data.length) await tx.loyaltyLedger.createMany({ data });
  return { restoredValue: Math.max(0, backValue), reversed: Math.max(0, rev), restored: Math.max(0, back) };
}

/** Customer's balance and history, newest first. */
export async function customerPoints(ctx: Ctx, customerId: string) {
  const [rows, bal, s] = await Promise.all([
    db.loyaltyLedger.findMany({ where: { tenantId: ctx.tenantId, customerId }, orderBy: { at: "desc" }, take: 100 }),
    pointsBalance(db, ctx.tenantId, customerId), loyaltySettings(ctx.tenantId),
  ]);
  return { balance: bal, value: bal * s.pointValuePaise, rows: rows.map((r) => ({ id: r.id, at: r.at.toISOString(), kind: r.kind, points: r.points, value: big(r.valuePaise), note: r.note, expiresAt: r.expiresAt?.toISOString() ?? null })) };
}

/** Points line for a receipt. */
export async function salePoints(tenantId: string, saleId: string, customerId: string | null) {
  if (!customerId) return null;
  const rows = await db.loyaltyLedger.findMany({ where: { tenantId, saleId } });
  if (!rows.length) return null;
  return { earned: sum(rows, "earn").pts, redeemed: sum(rows, "redeem").pts, redeemedValue: sum(rows, "redeem").val, balance: await pointsBalance(db, tenantId, customerId) };
}

/**
 * Daily expiry: for each customer, points earned (or given back) that have passed their expiry and weren't
 * used, taken back or already expired go in one "expire" row. Oldest points are used first.
 */
export async function expirePoints(now = new Date()) {
  const tenants = await db.$queryRaw<{ id: string }[]>`SELECT id FROM "Tenant" WHERE settings->'loyalty'->>'enabled' = 'true'`;
  const day = todayISO(now);
  let expired = 0;
  for (const t of tenants) {
    const claimed = await db.$executeRaw`UPDATE "Tenant" SET settings = jsonb_set(settings, '{loyaltyExpiryDay}', to_jsonb(${day}::text)) WHERE id = ${t.id} AND COALESCE(settings->>'loyaltyExpiryDay', '') <> ${day}`;
    if (!claimed) continue;
    await db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<{ customerId: string; due: bigint }[]>`
        SELECT "customerId", SUM(CASE WHEN points > 0 AND "expiresAt" <= ${now} THEN points ELSE 0 END) + SUM(CASE WHEN points < 0 THEN points ELSE 0 END) due
        FROM "LoyaltyLedger" WHERE "tenantId" = ${t.id} GROUP BY 1`;
      const lapse = rows.filter((r) => Number(r.due) > 0);
      if (!lapse.length) return;
      await tx.loyaltyLedger.createMany({ data: lapse.map((r) => ({ tenantId: t.id, customerId: r.customerId, kind: "expire", points: -Number(r.due), note: "Expired", at: now })) });
      const n = lapse.reduce((a, r) => a + Number(r.due), 0);
      expired += n;
      await writeAudit(tx, { tenantId: t.id, userName: "Scheduler", action: "Loyalty points expired", entity: "loyalty", detail: `${n} points · ${lapse.length} customer${lapse.length > 1 ? "s" : ""}` });
    });
  }
  return expired;
}
