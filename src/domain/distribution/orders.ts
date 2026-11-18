import "server-only";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db, type DbOrTx, type Tx } from "@/server/db";
import { UserError } from "@/server/action";
import type { Ctx } from "@/server/context";
import { nextSeq, pad } from "@/server/sequence";
import { zId } from "@/lib/id";
import { dateOnly, fiscalYear, isoOf, todayISO } from "@/lib/dates";
import { customerBalance } from "@/domain/parties/balances";
import { distAuthorize, distCan } from "./context";
import { audit, distSettings, lockKey, num } from "./common";
import { invoiceTotals, rateFor } from "./rules/pricing";
import { bestScheme, type Scheme } from "./rules/schemes";
import { creditCheck, type CreditDecision } from "./rules/credit";
import { allocateFefoReserved, ShortStockError, splitPaidFree, type AllocBatch } from "./rules/allocation";
import { assertMove, OPEN_STATUSES, ORDER_STATUS, type OrderStatus } from "./rules/orderflow";
import { openBills } from "./rules/ageing";

export { ORDER_STATUS };

/** Who is acting: a signed-in distributor user, or a chemist on the portal (only for their own connected account). */
export type Actor = { kind: "user"; ctx: Ctx } | { kind: "chemist"; tenantId: string; accountId: string; customerId: string };
const tenantOf = (a: Actor) => (a.kind === "user" ? a.ctx.tenantId : a.tenantId);

// ───────────── Quoting: rate, scheme and stock for a chemist ─────────────

export type QuoteLine = {
  medicineId: string; name: string; pack: string; qty: number; freeQty: number; rate: number; discPct: number; schemeId: string | null; scheme: string | null;
  gstRate: number; mrp: number; minOrderQty: number; available: number; problem: string | null;
};

export async function activeSchemes(q: DbOrTx, tenantId: string, today = todayISO()): Promise<Scheme[]> {
  const rows = await q.distScheme.findMany({ where: { tenantId, active: true, validFrom: { lte: dateOnly(today) }, validTo: { gte: dateOnly(today) } } });
  return rows.map((s) => ({ ...s, kind: s.kind as Scheme["kind"], discPct: num(s.discPct), validFrom: isoOf(s.validFrom), validTo: isoOf(s.validTo) }));
}

/** Stock units already promised to open pick lists, per batch. */
export async function reservedUnits(q: DbOrTx, tenantId: string, batchIds: string[], exceptPickList?: string) {
  if (!batchIds.length) return {};
  const rows = await q.$queryRaw<{ batchId: string; u: bigint }[]>`
    SELECT l."batchId", SUM(l.units)::bigint u FROM "DistPickLine" l JOIN "DistPickList" p ON p.id = l."pickListId"
    WHERE p."tenantId" = ${tenantId} AND p.status IN ('open', 'picked', 'packed') AND l."batchId" = ANY(${batchIds}) AND p.id <> ${exceptPickList ?? ""}
    GROUP BY l."batchId"`;
  return Object.fromEntries(rows.map((r) => [r.batchId, Number(r.u)])) as Record<string, number>;
}

/** Sellable packs per product in a godown (not expired inside the minimum shelf life, minus reservations). */
export async function availablePacks(q: DbOrTx, tenantId: string, branchId: string, medicineIds: string[], minShelfDays: number) {
  const cutoff = new Date(dateOnly(todayISO()).getTime() + Math.max(1, minShelfDays) * 86400000);
  const batches = await q.batch.findMany({ where: { tenantId, branchId, medicineId: { in: medicineIds }, status: "ok", expiryDate: { gte: cutoff }, qtyAvailable: { gt: 0 } }, include: { medicine: { select: { packSize: true } } } });
  const res = await reservedUnits(q, tenantId, batches.map((b) => b.id));
  const out: Record<string, number> = {};
  for (const b of batches) out[b.medicineId] = (out[b.medicineId] ?? 0) + Math.floor(Math.max(0, b.qtyAvailable - (res[b.id] ?? 0)) / Math.max(1, b.medicine.packSize));
  return out;
}

export async function quote(q: DbOrTx, tenantId: string, branchId: string, customerId: string, lines: { medicineId: string; qty: number }[]): Promise<QuoteLine[]> {
  const ids = [...new Set(lines.map((l) => l.medicineId))];
  const [chem, meds, dps, specials, schemes, settings] = await Promise.all([
    q.distChemist.findFirst({ where: { customerId, tenantId } }),
    q.medicine.findMany({ where: { tenantId, id: { in: ids } } }),
    q.distProduct.findMany({ where: { tenantId, medicineId: { in: ids } } }),
    q.distSpecialRate.findMany({ where: { tenantId, customerId, medicineId: { in: ids } } }),
    activeSchemes(q, tenantId),
    distSettings(tenantId, q),
  ]);
  if (!chem) throw new UserError("Chemist not found.");
  const avail = await availablePacks(q, tenantId, branchId, ids, settings.minShelfDays);
  return lines.map((l) => {
    const m = meds.find((x) => x.id === l.medicineId), d = dps.find((x) => x.medicineId === l.medicineId);
    if (!m || !d) return { medicineId: l.medicineId, name: m?.name ?? "Unknown product", pack: m?.pack ?? "", qty: l.qty, freeQty: 0, rate: 0, discPct: 0, schemeId: null, scheme: null, gstRate: m?.gstRate ?? 0, mrp: num(m?.mrpPaise), minOrderQty: 1, available: 0, problem: "Not set up for wholesale (no PTR)." };
    const sp = specials.find((x) => x.medicineId === m.id);
    const rate = rateFor({ ptr: num(d.ptrPaise), pts: num(d.ptsPaise) }, chem.priceTier, sp ? { rate: num(sp.ratePaise), validTo: sp.validTo ? isoOf(sp.validTo) : null } : null);
    const sch = bestScheme(schemes, { medicineId: m.id, companyId: d.companyId, qty: l.qty, customerId }, todayISO());
    const problem = d.discontinued || !m.active ? "Discontinued." : !Number.isInteger(l.qty) || l.qty < 1 ? "Enter a quantity." : l.qty < d.minOrderQty ? `Minimum order is ${d.minOrderQty}.` : null;
    return { medicineId: m.id, name: m.name, pack: m.pack, qty: l.qty, freeQty: sch.freeQty, rate, discPct: sch.discPct, schemeId: sch.schemeId, scheme: sch.label, gstRate: m.gstRate, mrp: num(m.mrpPaise), minOrderQty: d.minOrderQty, available: avail[m.id] ?? 0, problem };
  });
}

// ───────────── Credit ─────────────

export async function creditFor(q: DbOrTx, tenantId: string, customerId: string, orderValue: number, exceptOrderId?: string): Promise<CreditDecision & { balance: number; limit: number }> {
  const today = todayISO();
  const [c, chem, balance, pending, invoices, bounces] = await Promise.all([
    q.customer.findFirst({ where: { id: customerId, tenantId } }),
    q.distChemist.findFirst({ where: { customerId, tenantId } }),
    customerBalance(q, tenantId, customerId),
    q.distOrder.aggregate({ where: { tenantId, customerId, status: { in: ["approved", "picking", "packed"] }, ...(exceptOrderId ? { NOT: { id: exceptOrderId } } : {}) }, _sum: { estimatePaise: true } }),
    q.distInvoice.findMany({ where: { tenantId, customerId }, select: { id: true, no: true, date: true, dueDate: true, totalPaise: true }, orderBy: { date: "desc" }, take: 500 }),
    q.cheque.count({ where: { tenantId, partyType: "customer", partyId: customerId, status: "bounced", bouncedAt: { gte: new Date(Date.now() - 90 * 86400000) } } }),
  ]);
  if (!c || !chem) throw new UserError("Chemist not found.");
  const open = openBills(invoices.map((i) => ({ id: i.id, no: i.no, date: isoOf(i.date), dueDate: isoOf(i.dueDate), total: num(i.totalPaise) })), balance, today);
  const oldest = open.filter((b) => b.id !== "opening")[0];
  const d = creditCheck({
    limit: num(c.creditLimitPaise), balance, orderValue, pendingOrders: num(pending._sum.estimatePaise), oldestOpenDays: oldest ? oldest.ageDays : null,
    creditDays: chem.creditDays, graceDays: chem.graceDays, status: chem.status, dlExpiry: chem.dlExpiry ? isoOf(chem.dlExpiry) : null, bouncedCheques90d: bounces, today,
  });
  return { ...d, balance, limit: num(c.creditLimitPaise) };
}

// ───────────── Placing orders ─────────────

export const orderSchema = z.object({
  customerId: zId("Choose the chemist."),
  branchId: z.string().default(""),
  source: z.enum(["portal", "salesman", "phone", "office"]).default("office"),
  note: z.string().trim().max(300).default(""),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, "Missing order key; reload and try again."),
  lines: z.array(z.object({ medicineId: zId(), qty: z.coerce.number().int().min(1, "Quantity must be at least 1.").max(100000) })).min(1, "Add at least one product.").max(300, "Up to 300 products per order."),
});
export type OrderInput = z.input<typeof orderSchema>;

export async function placeOrder(actor: Actor, raw: OrderInput) {
  const i = orderSchema.parse(raw);
  const tenantId = tenantOf(actor);
  if (actor.kind === "user") {
    distAuthorize(actor.ctx, "order");
    // A salesman books only for chemists assigned to them.
    const sm = await db.distSalesman.findFirst({ where: { tenantId, userId: actor.ctx.userId, active: true } });
    if (sm && !distCan(actor.ctx, "approve")) {
      const chem = await db.distChemist.findFirst({ where: { tenantId, customerId: i.customerId } });
      if (chem?.salesmanId !== sm.id) throw new UserError("This chemist isn’t assigned to you.");
    }
  } else if (actor.customerId !== i.customerId) throw new UserError("You can only order for your own pharmacy.");
  const dupLines = new Set<string>();
  for (const l of i.lines) { if (dupLines.has(l.medicineId)) throw new UserError("A product appears twice. Combine the lines."); dupLines.add(l.medicineId); }

  const existing = await db.distOrder.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: i.idempotencyKey } } });
  if (existing) return replayOf(existing);

  const settings = await distSettings(tenantId);
  const branchId = i.branchId || (actor.kind === "user" ? actor.ctx.branchId : (await db.branch.findFirstOrThrow({ where: { tenantId, active: true }, orderBy: { createdAt: "asc" } })).id);
  if (actor.kind === "user" && !actor.ctx.branches.some((b) => b.id === branchId)) throw new UserError("You don’t have access to that godown.");
  const lines = await quote(db, tenantId, branchId, i.customerId, i.lines);
  const bad = lines.find((l) => l.problem);
  if (bad) throw new UserError(`${bad.name}: ${bad.problem}`);
  const inter = await isInterState(db, tenantId, branchId, i.customerId);
  const est = invoiceTotals(lines.map((l) => ({ qty: l.qty, rate: l.rate, gstRate: l.gstRate, discPct: l.discPct })), inter).total;
  if (actor.kind === "chemist" && est < settings.portal.minOrderPaise) throw new UserError(`Minimum order value is ₹${(settings.portal.minOrderPaise / 100).toFixed(0)}.`);
  const credit = await creditFor(db, tenantId, i.customerId, est);
  if (credit.hard) throw new UserError(`Order can’t be accepted: ${credit.reasons.join(" ")}`);

  try {
    return await db.$transaction(async (tx) => {
      const fy = fiscalYear();
      const no = `SO-${fy}-${pad(await nextSeq(tx, tenantId, "DSO:" + fy), 5)}`;
      const by = actor.kind === "user" ? { placedByType: "user", placedById: actor.ctx.userId } : { placedByType: "chemist", placedById: actor.accountId };
      const sm = actor.kind === "user" ? await tx.distSalesman.findFirst({ where: { tenantId, userId: actor.ctx.userId } }) : null;
      const chem = await tx.distChemist.findFirstOrThrow({ where: { tenantId, customerId: i.customerId } });
      const o = await tx.distOrder.create({
        data: {
          tenantId, branchId, no, customerId: i.customerId, source: actor.kind === "chemist" ? "portal" : i.source, salesmanId: sm?.id ?? chem.salesmanId, status: "pending", ...by,
          note: i.note || null, estimatePaise: BigInt(est), creditCheck: credit as unknown as Prisma.InputJsonValue, idempotencyKey: i.idempotencyKey,
          lines: { create: lines.map((l) => ({ medicineId: l.medicineId, qty: l.qty, freeQty: l.freeQty, ratePaise: BigInt(l.rate), discPct: l.discPct, schemeId: l.schemeId })) },
        },
      });
      const who = actor.kind === "user" ? actor.ctx : null;
      if (who) await audit(tx, who, "Order placed", "dist_order", o.id, `${no} · ${lines.length} line(s) · ₹${(est / 100).toFixed(2)}${credit.ok ? "" : " · credit hold: " + credit.reasons.join(" ")}`);
      else await (await import("@/server/audit")).writeAudit(tx, { tenantId, action: "Order placed on portal", entity: "dist_order", entityId: o.id, userName: "Chemist portal", detail: `${no} · ${lines.length} line(s) · ₹${(est / 100).toFixed(2)}` });
      return { orderId: o.id, no, status: o.status, replayed: false, creditOk: credit.ok, reasons: credit.reasons };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const o = await db.distOrder.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: i.idempotencyKey } } });
      if (o) return replayOf(o);
    }
    throw e;
  }
}

const replayOf = (o: { id: string; no: string; status: string; creditCheck: Prisma.JsonValue }) => {
  const c = o.creditCheck as { ok?: boolean; reasons?: string[] } | null;
  return { orderId: o.id, no: o.no, status: o.status, replayed: true, creditOk: c?.ok ?? true, reasons: c?.reasons ?? [] };
};

export async function isInterState(q: DbOrTx, tenantId: string, branchId: string, customerId: string) {
  const [b, t, c] = await Promise.all([
    q.branch.findFirst({ where: { id: branchId, tenantId }, select: { gstin: true } }),
    q.tenant.findUnique({ where: { id: tenantId }, select: { gstin: true } }),
    q.customer.findFirst({ where: { id: customerId, tenantId }, select: { stateCode: true, gstin: true } }),
  ]);
  const own = (b?.gstin ?? t?.gstin ?? "").slice(0, 2);
  const theirs = c?.stateCode ?? c?.gstin?.slice(0, 2) ?? own;
  return !!own && !!theirs && own !== theirs;
}

// ───────────── Approval and stock reservation ─────────────

async function lockOrder(tx: Tx, ctx: { tenantId: string }, id: string) {
  await lockKey(tx, "dist_order:" + id);
  const o = await tx.distOrder.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { lines: true } });
  if (!o) throw new UserError("Order not found.");
  return o;
}

/** Locks every batch of these products in a godown, in id order (no deadlocks), and returns them with packs and racks. */
export async function lockBatches(tx: Tx, tenantId: string, branchId: string, medicineIds: string[]) {
  const ids = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Batch" WHERE "tenantId" = ${tenantId} AND "branchId" = ${branchId} AND "medicineId" = ANY(${medicineIds}) ORDER BY id FOR UPDATE`;
  const rows = await tx.batch.findMany({ where: { id: { in: ids.map((r) => r.id) } }, include: { medicine: { select: { packSize: true, name: true } } } });
  const racks = await tx.medicineRack.findMany({ where: { branchId, medicineId: { in: medicineIds } } });
  return rows.map((b) => ({ ...b, rack: racks.find((r) => r.medicineId === b.medicineId)?.rack ?? null }));
}

const asAlloc = (b: Awaited<ReturnType<typeof lockBatches>>[number]): AllocBatch => ({ id: b.id, medicineId: b.medicineId, batchNo: b.batchNo, expiry: isoOf(b.expiryDate), qtyAvailable: b.qtyAvailable, status: b.status, rack: b.rack });

export const approveSchema = z.object({ overrideReason: z.string().trim().max(200).default(""), allowPartial: z.boolean().default(false) });

/**
 * Approves an order: re-checks credit (a hold needs the credit-override permission and a reason), then reserves
 * stock batch-wise FEFO in a pick list. With `allowPartial`, short lines are cut to what is available.
 */
export async function approveOrder(ctx: Ctx, id: string, raw: z.input<typeof approveSchema> = {}) {
  distAuthorize(ctx, "approve");
  const i = approveSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const o = await lockOrder(tx, ctx, id);
    assertMove(o.status, "approved");
    const credit = await creditFor(tx, ctx.tenantId, o.customerId, num(o.estimatePaise), o.id);
    if (credit.hard) throw new UserError(`Can’t approve: ${credit.reasons.join(" ")}`);
    if (!credit.ok) {
      if (!distCan(ctx, "creditOverride")) throw new UserError(`Credit hold: ${credit.reasons.join(" ")} Ask a manager with credit override to approve it.`);
      if (i.overrideReason.length < 5) throw new UserError(`Credit hold: ${credit.reasons.join(" ")} Enter a reason to override.`);
      if ((await distSettings(ctx.tenantId, tx)).creditMode === "block") throw new UserError(`Credit rules block this order: ${credit.reasons.join(" ")}`);
    }
    const settings = await distSettings(ctx.tenantId, tx);
    const meds = [...new Set(o.lines.map((l) => l.medicineId))];
    const batches = await lockBatches(tx, ctx.tenantId, o.branchId, meds);
    const reserved = await reservedUnits(tx, ctx.tenantId, batches.map((b) => b.id));
    const pickLines: Prisma.DistPickLineCreateWithoutPickListInput[] = [];
    const cut: string[] = [];
    for (const l of o.lines) {
      const pack = batches.find((b) => b.medicineId === l.medicineId)?.medicine.packSize ?? 1;
      const name = batches.find((b) => b.medicineId === l.medicineId)?.medicine.name ?? "Product";
      let paid = l.qty, free = l.freeQty;
      let allocs;
      try {
        allocs = allocateFefoReserved(batches.map(asAlloc), l.medicineId, (paid + free) * pack, { reserved, today: todayISO(), minShelfDays: settings.minShelfDays, packSize: pack });
      } catch (e) {
        if (!(e instanceof ShortStockError)) throw e;
        if (!i.allowPartial) throw new UserError(`${name}: only ${e.available} available, ordered ${paid + free}. Approve with “cut short lines” or wait for stock.`);
        const can = e.available;
        if (can <= 0) { cut.push(`${name} 0/${paid + free}`); await tx.distOrderLine.delete({ where: { id: l.id } }); continue; }
        // Keep the scheme ratio: free goods only for the paid packs that still go.
        const ratio = paid ? free / (paid + free) : 0;
        free = Math.floor(can * ratio); paid = can - free;
        cut.push(`${name} ${can}/${l.qty + l.freeQty}`);
        await tx.distOrderLine.update({ where: { id: l.id }, data: { qty: paid, freeQty: free } });
        allocs = allocateFefoReserved(batches.map(asAlloc), l.medicineId, can * pack, { reserved, today: todayISO(), minShelfDays: settings.minShelfDays, packSize: pack });
      }
      for (const a of splitPaidFree(allocs, paid * pack)) {
        reserved[a.batchId] = (reserved[a.batchId] ?? 0) + a.units;
        pickLines.push({ orderLineId: l.id, medicineId: l.medicineId, batchId: a.batchId, rack: a.rack, units: a.units, paidUnits: a.paidUnits || 0 });
      }
    }
    if (!pickLines.length) throw new UserError("Nothing on this order is in stock.");
    const fy = fiscalYear();
    const no = `PK-${fy}-${pad(await nextSeq(tx, ctx.tenantId, "DPK:" + fy), 5)}`;
    await tx.distPickList.create({ data: { tenantId: ctx.tenantId, branchId: o.branchId, no, orderId: o.id, lines: { create: pickLines } } });
    await tx.distOrder.update({
      where: { id: o.id },
      data: { status: "approved", decidedBy: ctx.userId, decidedAt: new Date(), creditCheck: credit as unknown as Prisma.InputJsonValue, overrideBy: credit.ok ? null : ctx.userId, overrideReason: credit.ok ? null : i.overrideReason, estimatePaise: BigInt(await estimateOf(tx, ctx.tenantId, o.id)), version: { increment: 1 } },
    });
    await audit(tx, ctx, credit.ok ? "Order approved" : "Order approved over credit hold", "dist_order", o.id, `${o.no} · pick list ${no}${cut.length ? " · cut: " + cut.join(", ") : ""}${credit.ok ? "" : " · " + credit.reasons.join(" ") + " · reason: " + i.overrideReason}`);
    return { pickNo: no, cut };
  }, { timeout: 20000 });
}

/** Order value with current lines and real GST rates. */
export async function estimateOf(q: DbOrTx, tenantId: string, orderId: string) {
  const o = await q.distOrder.findFirstOrThrow({ where: { id: orderId, tenantId }, include: { lines: true } });
  if (!o.lines.length) return 0;
  const meds = await q.medicine.findMany({ where: { id: { in: o.lines.map((l) => l.medicineId) } }, select: { id: true, gstRate: true } });
  const inter = await isInterState(q, tenantId, o.branchId, o.customerId);
  return invoiceTotals(o.lines.map((l) => ({ qty: l.qty, rate: num(l.ratePaise), gstRate: meds.find((m) => m.id === l.medicineId)?.gstRate ?? 12, discPct: num(l.discPct) })), inter).total;
}

export async function rejectOrder(ctx: Ctx, id: string, reason: string) {
  distAuthorize(ctx, "approve");
  if (reason.trim().length < 3) throw new UserError("Give a reason for the chemist.");
  return db.$transaction(async (tx) => {
    const o = await lockOrder(tx, ctx, id);
    assertMove(o.status, "rejected");
    await tx.distOrder.update({ where: { id }, data: { status: "rejected", rejectReason: reason.trim(), decidedBy: ctx.userId, decidedAt: new Date(), version: { increment: 1 } } });
    await audit(tx, ctx, "Order rejected", "dist_order", id, `${o.no} · ${reason.trim()}`);
  });
}

/** Cancels an order before it is invoiced, releasing its reserved stock. Chemists may cancel only while it awaits approval. */
export async function cancelOrder(actor: Actor, id: string, reason: string) {
  const tenantId = tenantOf(actor);
  if (actor.kind === "user") distAuthorize(actor.ctx, "approve");
  return db.$transaction(async (tx) => {
    const o = await lockOrder(tx, { tenantId }, id);
    if (actor.kind === "chemist" && (o.customerId !== actor.customerId || o.status !== "pending")) throw new UserError("This order can no longer be cancelled from the portal. Call your distributor.");
    assertMove(o.status, "cancelled");
    await tx.distPickList.updateMany({ where: { orderId: id, status: { in: ["open", "picked", "packed"] } }, data: { status: "cancelled" } });
    await tx.distOrder.update({ where: { id }, data: { status: "cancelled", rejectReason: reason.trim() || null, version: { increment: 1 } } });
    if (actor.kind === "user") await audit(tx, actor.ctx, "Order cancelled", "dist_order", id, `${o.no}${reason ? " · " + reason : ""}`);
    else await (await import("@/server/audit")).writeAudit(tx, { tenantId, action: "Order cancelled on portal", entity: "dist_order", entityId: id, userName: "Chemist portal", detail: o.no });
  });
}

// ───────────── Warehouse: pick and pack ─────────────

async function lockPick(tx: Tx, ctx: Ctx, id: string) {
  await lockKey(tx, "dist_pick:" + id);
  const p = await tx.distPickList.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { lines: true } });
  if (!p) throw new UserError("Pick list not found.");
  if (!ctx.branches.some((b) => b.id === p.branchId)) throw new UserError("This pick list belongs to a godown you can’t access.");
  return p;
}

export async function startPicking(ctx: Ctx, pickId: string) {
  distAuthorize(ctx, "warehouse");
  return db.$transaction(async (tx) => {
    const p = await lockPick(tx, ctx, pickId);
    if (p.status !== "open") throw new UserError("This pick list is already being processed.");
    const o = await lockOrder(tx, ctx, p.orderId);
    if (o.status === "approved") {
      assertMove(o.status, "picking");
      await tx.distOrder.update({ where: { id: o.id }, data: { status: "picking", version: { increment: 1 } } });
    }
    await tx.distPickList.update({ where: { id: p.id }, data: { pickerId: p.pickerId ?? ctx.userId } });
    await audit(tx, ctx, "Picking started", "dist_pick", p.id, `${p.no} · ${o.no}`);
  });
}

/** Records what was actually taken from the rack for a pick line; a short pick releases the rest. */
export async function confirmPickLine(ctx: Ctx, lineId: string, pickedUnits: number) {
  distAuthorize(ctx, "warehouse");
  if (!Number.isInteger(pickedUnits) || pickedUnits < 0) throw new UserError("Enter the quantity picked.");
  return db.$transaction(async (tx) => {
    const line = await tx.distPickLine.findFirst({ where: { id: lineId, pickList: { tenantId: ctx.tenantId } } });
    if (!line) throw new UserError("Pick line not found.");
    const p = await lockPick(tx, ctx, line.pickListId);
    if (p.status !== "open") throw new UserError("This pick list is closed.");
    if (pickedUnits > line.units) throw new UserError(`Only ${line.units} were reserved from this batch.`);
    const o = await tx.distOrder.findFirstOrThrow({ where: { id: p.orderId } });
    if (o.status === "approved") await tx.distOrder.update({ where: { id: o.id }, data: { status: "picking", version: { increment: 1 } } });
    await tx.distPickLine.update({ where: { id: line.id }, data: { pickedUnits, pickedAt: new Date(), pickedBy: ctx.userId } });
    if (pickedUnits < line.units) await audit(tx, ctx, "Short pick", "dist_pick", p.id, `${p.no} · batch line ${line.id.slice(0, 8)} · picked ${pickedUnits} of ${line.units}`);
  });
}

export async function packOrder(ctx: Ctx, pickId: string, boxes: number) {
  distAuthorize(ctx, "warehouse");
  if (!Number.isInteger(boxes) || boxes < 1 || boxes > 999) throw new UserError("Enter the number of boxes.");
  return db.$transaction(async (tx) => {
    const p = await lockPick(tx, ctx, pickId);
    if (p.status !== "open") throw new UserError("This pick list was already packed.");
    const open = p.lines.filter((l) => l.pickedUnits == null);
    if (open.length) throw new UserError(`${open.length} line(s) not picked yet.`);
    if (!p.lines.some((l) => (l.pickedUnits ?? 0) > 0)) throw new UserError("Nothing was picked. Cancel the order instead.");
    const o = await lockOrder(tx, ctx, p.orderId);
    if (o.status === "approved") await tx.distOrder.update({ where: { id: o.id }, data: { status: "picking" } });
    assertMove(o.status === "approved" ? "picking" : o.status, "packed");
    await tx.distPickList.update({ where: { id: p.id }, data: { status: "packed", boxes, packedAt: new Date(), packedBy: ctx.userId, pickedAt: p.pickedAt ?? new Date() } });
    await tx.distOrder.update({ where: { id: o.id }, data: { status: "packed", version: { increment: 1 } } });
    await audit(tx, ctx, "Order packed", "dist_order", o.id, `${o.no} · ${boxes} box(es)`);
  });
}

// ───────────── Lists ─────────────

export async function listOrders(ctx: Ctx, opts: { status?: OrderStatus | "open" | "all"; customerId?: string; take?: number } = {}) {
  const st = opts.status ?? "open";
  const rows = await db.distOrder.findMany({
    where: { tenantId: ctx.tenantId, branchId: { in: ctx.branches.map((b) => b.id) }, ...(st === "open" ? { status: { in: OPEN_STATUSES } } : st === "all" ? {} : { status: st }), ...(opts.customerId ? { customerId: opts.customerId } : {}) },
    orderBy: { placedAt: "desc" }, take: opts.take ?? 200, include: { lines: true },
  });
  const custs = await db.customer.findMany({ where: { id: { in: rows.map((r) => r.customerId) } }, select: { id: true, name: true } });
  return rows.map((o) => ({ ...o, customer: custs.find((c) => c.id === o.customerId)?.name ?? "—", estimate: num(o.estimatePaise), lineCount: o.lines.length, credit: o.creditCheck as { ok: boolean; reasons: string[] } | null }));
}

export async function orderDetail(ctx: Ctx, id: string) {
  const o = await db.distOrder.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { lines: true } });
  if (!o) return null;
  const [cust, meds, pick, inv] = await Promise.all([
    db.customer.findUnique({ where: { id: o.customerId } }),
    db.medicine.findMany({ where: { id: { in: o.lines.map((l) => l.medicineId) } } }),
    db.distPickList.findUnique({ where: { orderId: o.id }, include: { lines: true } }),
    o.invoiceId ? db.distInvoice.findUnique({ where: { id: o.invoiceId } }) : null,
  ]);
  const batches = pick ? await db.batch.findMany({ where: { id: { in: pick.lines.map((l) => l.batchId) } } }) : [];
  return {
    ...o, estimate: num(o.estimatePaise), customer: cust?.name ?? "—", credit: o.creditCheck as { ok: boolean; reasons: string[]; balance: number; limit: number } | null,
    lines: o.lines.map((l) => ({ ...l, name: meds.find((m) => m.id === l.medicineId)?.name ?? "—", pack: meds.find((m) => m.id === l.medicineId)?.pack ?? "", rate: num(l.ratePaise), discPct: num(l.discPct) })),
    pick: pick && { ...pick, lines: pick.lines.map((l) => { const b = batches.find((x) => x.id === l.batchId); const m = meds.find((x) => x.id === l.medicineId); return { ...l, batchNo: b?.batchNo ?? "—", expiry: b ? isoOf(b.expiryDate) : "", name: m?.name ?? "—", packSize: m?.packSize ?? 1 }; }).sort((a, b) => (a.rack ?? "~").localeCompare(b.rack ?? "~")) },
    invoice: inv && { id: inv.id, no: inv.no, total: num(inv.totalPaise) },
  };
}

/** Pick lists waiting in a godown, rack order. */
export async function pickQueue(ctx: Ctx, branchId = ctx.branchId) {
  const lists = await db.distPickList.findMany({ where: { tenantId: ctx.tenantId, branchId, status: { in: ["open", "packed"] } }, include: { lines: true }, orderBy: { createdAt: "asc" } });
  const orders = await db.distOrder.findMany({ where: { id: { in: lists.map((l) => l.orderId) } }, select: { id: true, no: true, customerId: true, status: true } });
  const custs = await db.customer.findMany({ where: { id: { in: orders.map((o) => o.customerId) } }, select: { id: true, name: true } });
  return lists.map((l) => { const o = orders.find((x) => x.id === l.orderId)!; return { ...l, orderNo: o.no, orderStatus: o.status, customer: custs.find((c) => c.id === o.customerId)?.name ?? "—", picked: l.lines.filter((x) => x.pickedUnits != null).length }; });
}
