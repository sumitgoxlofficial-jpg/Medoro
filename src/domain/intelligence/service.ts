import "server-only";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorize, authorizeAny, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { addDays, dateOnly, daysTo, isoOf, startOfTodayIST, todayISO } from "@/lib/dates";
import { fmtQty, stockValue } from "@/lib/units";
import { big } from "@/lib/money";
import { sellableByMedicine, velocity } from "@/domain/inventory/queries";
import { createPo } from "@/domain/purchasing/service";
import { inr } from "@/lib/money";
import { monthCoverage, seasonalLine } from "./seasonal";

type Settings = { policy?: { cover: number; safety: number }; anomaly?: { disc: number; refunds: number; cash: number } };
export async function settings(tenantId: string) {
  const t = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const s = t.settings as Settings;
  return { policy: s.policy ?? { cover: 21, safety: 2 }, anomaly: s.anomaly ?? { disc: 5, refunds: 2, cash: 200 } };
}

export async function saveSettings(ctx: Ctx, patch: Partial<{ policy: { cover: number; safety: number }; anomaly: { disc: number; refunds: number; cash: number } }>) {
  authorizeAny(ctx, "reports", "purchase");
  if (patch.policy && (![7, 14, 21, 30].includes(patch.policy.cover) || ![1, 2, 3, 5].includes(patch.policy.safety))) throw new UserError("Invalid policy.");
  if (patch.anomaly && Object.values(patch.anomaly).some((v) => !Number.isFinite(v) || v < 0 || v > 100000)) throw new UserError("Invalid threshold.");
  const t = await db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
  await db.tenant.update({ where: { id: ctx.tenantId }, data: { settings: { ...(t.settings as object), ...patch } } });
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Intelligence settings changed", entity: "tenant", detail: JSON.stringify(patch) });
}

// ───────────── Expiry prevention ─────────────

export async function expiryRows(ctx: Ctx, windowDays: number) {
  const today = todayISO();
  const [batches, vel, branches] = await Promise.all([
    db.batch.findMany({ where: { tenantId: ctx.tenantId, branchId: ctx.branchId, qtyAvailable: { gt: 0 }, expiryDate: { lte: dateOnly(addDays(today, windowDays)) } }, include: { medicine: true, supplier: true }, orderBy: { expiryDate: "asc" } }),
    velocity(ctx.tenantId, ctx.branchId),
    db.branch.findMany({ where: { tenantId: ctx.tenantId, active: true, id: { not: ctx.branchId } }, select: { id: true, name: true } }),
  ]);
  const elsewhere = await Promise.all(branches.map(async (b) => ({ b, v: await velocity(ctx.tenantId, b.id) })));
  const rows = batches.map((b) => {
    // Quantities here are stock units (loose units for medicines sold loose); velocity is per pack, so scale it.
    const ps = b.medicine.packSize, d = daysTo(b.expiryDate, today), v = (vel.get(b.medicineId) ?? 0) * ps, cost = big(b.costPaise);
    const sold = Math.min(b.qtyAvailable, Math.floor(v * Math.max(0, d))), unsold = b.qtyAvailable - sold;
    const best = elsewhere.map((x) => ({ ...x.b, v: (x.v.get(b.medicineId) ?? 0) * ps })).sort((a, c) => c.v - a.v)[0];
    let rec: { kind: "none" | "return" | "transfer" | "promote" | "writeoff"; text: string; branchId?: string };
    if (d <= 0) rec = b.supplier?.acceptsReturns ? { kind: "return", text: `Expired. Return to ${b.supplier.name} if they accept expired returns, else write off.` } : { kind: "writeoff", text: "Expired and blocked from sale. Write off." };
    else if (!unsold) rec = { kind: "none", text: "Sells through before expiry at the current rate." };
    else if (b.supplier?.acceptsReturns && d >= 20) rec = { kind: "return", text: `Return ${unsold} to ${b.supplier.name} while there are ${d} days left.` };
    else if (best && best.v > v && Math.floor(best.v * d) > 0) rec = { kind: "transfer", text: `${best.name} sells ${best.v.toFixed(1)}/day. Transfer ${Math.min(unsold, Math.floor(best.v * d))}.`, branchId: best.id };
    else rec = { kind: "promote", text: "Recommend to regular customers or discount within your cap." };
    return { id: b.id, medicine: b.medicine.name, batchNo: b.batchNo, expiry: isoOf(b.expiryDate), days: d, qty: b.qtyAvailable, qtyText: fmtQty(b.qtyAvailable, b.medicine), unitWord: ps > 1 ? `${b.medicine.looseUnit}s` : "units", cost, mrp: big(b.mrpPaise), status: b.status, velocity: v, sold, unsold, exposure: stockValue(cost, b.qtyAvailable, ps), loss: stockValue(cost, unsold, ps), supplier: b.supplier?.name ?? null, rec };
  });
  return { rows: rows.filter((r) => r.days > 0), expired: rows.filter((r) => r.days <= 0), branches };
}

// ───────────── Reorder forecast ─────────────

export async function forecast(ctx: Ctx, policy: { cover: number; safety: number }) {
  const [meds, stock, vel, lastBatches, sups] = await Promise.all([
    db.medicine.findMany({ where: { tenantId: ctx.tenantId, active: true }, orderBy: { name: "asc" } }),
    sellableByMedicine(ctx.tenantId, ctx.branchId), velocity(ctx.tenantId, ctx.branchId),
    db.batch.findMany({ where: { tenantId: ctx.tenantId, branchId: ctx.branchId, supplierId: { not: null } }, orderBy: { createdAt: "desc" }, select: { medicineId: true, supplierId: true, costPaise: true } }),
    db.supplier.findMany({ where: { tenantId: ctx.tenantId } }),
  ]);
  return meds.map((m) => {
    const st = stock.get(m.id) ?? 0, v = vel.get(m.id) ?? 0;
    const lb = lastBatches.find((b) => b.medicineId === m.id), sp = sups.find((s) => s.id === lb?.supplierId) ?? null;
    const lead = sp ? Number(sp.leadDays) : 1;
    const rop = Math.ceil(v * (lead + policy.safety)), target = Math.ceil(v * policy.cover);
    const trig = (v > 0 && st <= rop) || st < m.reorderLevel;
    const sug = trig ? Math.max(0, Math.max(target + rop, m.reorderLevel) - st) : 0;
    const cover = v ? Math.floor(st / v) : null;
    const why = sug ? (st < m.reorderLevel && st > rop ? `Stock ${st} is below the reorder level ${m.reorderLevel}.` : `Stock ${st} is at or below the reorder point ${rop} (${v.toFixed(1)}/day × ${lead + policy.safety} d lead + safety).`) + ` Orders up to ${policy.cover} days of cover.`
      : v ? "Above reorder point" : "No sales in the last 28 days";
    return { id: m.id, name: m.name, velocity: v, f14: Math.round(v * 14), stock: st, cover, lead, rop, suggestion: sug, why, supplierId: sp?.id ?? null, supplier: sp?.name ?? null, cost: big(lb?.costPaise) || Math.round(big(m.mrpPaise) * 0.7) };
  }).sort((a, b) => b.suggestion - a.suggestion || a.name.localeCompare(b.name));
}

/** One draft PO per supplier from the forecast's suggestions. */
export async function draftFromForecast(ctx: Ctx, policy: { cover: number; safety: number }, fallbackSupplierId: string | null) {
  authorize(ctx, "purchase");
  const rows = (await forecast(ctx, policy)).filter((r) => r.suggestion > 0);
  if (!rows.length) throw new UserError("Nothing needs reordering under this policy.");
  const bySup = new Map<string, typeof rows>();
  for (const r of rows) {
    const s = r.supplierId ?? fallbackSupplierId;
    if (!s) throw new UserError(`${r.name} has no supplier on record. Choose a default supplier.`);
    bySup.set(s, [...(bySup.get(s) ?? []), r]);
  }
  const out = [];
  for (const [s, rs] of bySup) out.push((await createPo(ctx, { supplierId: s, source: "intel", note: `Reorder policy ${policy.cover} d cover, ${policy.safety} d safety`, lines: rs.map((r) => ({ medicineId: r.id, qty: r.suggestion, rate: r.cost / 100 })) })).no);
  return out;
}

/** Seasonal pre-stock: one draft PO per supplier, each item going to its last supplier unless one is chosen. */
export async function draftSeasonal(ctx: Ctx, lines: { medicineId: string; qty: number; rate: number; supplierId?: string | null }[], month: string) {
  authorize(ctx, "purchase");
  if (!lines.length) throw new UserError("Select items to order.");
  const last = await db.batch.findMany({ where: { tenantId: ctx.tenantId, branchId: ctx.branchId, medicineId: { in: lines.map((l) => l.medicineId) }, supplierId: { not: null } }, orderBy: { createdAt: "desc" }, select: { medicineId: true, supplierId: true } });
  const meds = await db.medicine.findMany({ where: { tenantId: ctx.tenantId, id: { in: lines.map((l) => l.medicineId) } }, select: { id: true, name: true } });
  const bySup = new Map<string, typeof lines>();
  for (const l of lines) {
    const s = l.supplierId || last.find((b) => b.medicineId === l.medicineId)?.supplierId;
    if (!s) throw new UserError(`Choose a supplier for ${meds.find((m) => m.id === l.medicineId)?.name ?? "each item"}.`);
    bySup.set(s, [...(bySup.get(s) ?? []), l]);
  }
  const out = [];
  for (const [s, ls] of bySup) out.push((await createPo(ctx, { supplierId: s, source: "seasonal", note: `Seasonal pre-stock for ${month}`, lines: ls.map(({ medicineId, qty, rate }) => ({ medicineId, qty, rate })) })).no);
  return out;
}

// ───────────── Supplier prices from purchase history ─────────────

export async function priceComparison(ctx: Ctx) {
  const rows = await db.$queryRaw<{ medicineId: string; supplierId: string; rate: bigint; at: Date }[]>`
    SELECT DISTINCT ON (gi."medicineId", g."supplierId") gi."medicineId", g."supplierId", gi."ratePaise" rate, g."approvedAt" at
    FROM "GrnItem" gi JOIN "Grn" g ON g.id = gi."grnId" WHERE g."tenantId" = ${ctx.tenantId}
    ORDER BY gi."medicineId", g."supplierId", g."approvedAt" DESC`;
  const meds = await db.medicine.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.medicineId))] } }, select: { id: true, name: true } });
  const sups = await db.supplier.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } });
  const byMed = new Map<string, typeof rows>();
  for (const r of rows) byMed.set(r.medicineId, [...(byMed.get(r.medicineId) ?? []), r]);
  return [...byMed.entries()].filter(([, rs]) => rs.length > 1).map(([mid, rs]) => {
    const last = [...rs].sort((a, b) => +b.at - +a.at)[0], best = [...rs].sort((a, b) => Number(a.rate - b.rate))[0];
    return {
      name: meds.find((m) => m.id === mid)?.name ?? "", quotes: rs.map((r) => ({ supplier: sups.find((s) => s.id === r.supplierId)?.name ?? "", rate: Number(r.rate), date: r.at.toISOString() })),
      best: sups.find((s) => s.id === best.supplierId)?.name ?? "", savingPct: last.rate > best.rate ? (Number(last.rate - best.rate) / Number(last.rate)) * 100 : 0,
    };
  });
}

// ───────────── Slow and dead stock ─────────────

export async function slowStock(ctx: Ctx) {
  const [batches, vel] = await Promise.all([
    db.batch.findMany({ where: { tenantId: ctx.tenantId, branchId: ctx.branchId, qtyAvailable: { gt: 0 } }, include: { medicine: { select: { name: true, createdAt: true, packSize: true } } } }),
    velocity(ctx.tenantId, ctx.branchId, 90),
  ]);
  const by = new Map<string, { name: string; qty: number; value: number; age: number; ps: number }>();
  for (const b of batches) {
    const x = by.get(b.medicineId) ?? { name: b.medicine.name, qty: 0, value: 0, age: 0, ps: b.medicine.packSize };
    x.qty += b.qtyAvailable; x.value += stockValue(big(b.costPaise), b.qtyAvailable, x.ps); x.age = Math.max(x.age, -daysTo(b.createdAt));
    by.set(b.medicineId, x);
  }
  return [...by.entries()].map(([id, x]) => { const v = vel.get(id) ?? 0; return { ...x, velocity: v, cover: v ? Math.floor(x.qty / x.ps / v) : null }; })
    .filter((x) => x.age >= 30 && (x.velocity < 1 / 7 || (x.cover ?? 9999) > 90))
    .map((x) => ({ ...x, note: x.velocity === 0 ? "Dead stock: no sales in 90 days" : x.velocity < 1 / 7 ? "Slow mover: under 1 a week" : "Overstocked versus demand" }))
    .sort((a, b) => b.value - a.value);
}

// ───────────── Anomalies ─────────────

export async function anomalies(ctx: Ctx, th: { disc: number; refunds: number; cash: number }) {
  const since = new Date(Date.now() - 7 * 86400_000);
  const [sales, returns, shifts, counts, users, reviewed, signins, cost] = await Promise.all([
    db.sale.findMany({ where: { tenantId: ctx.tenantId, branchId: ctx.branchId, at: { gte: since }, discountPct: { gt: th.disc } }, select: { id: true, invoiceNo: true, discountPct: true, userId: true, at: true } }),
    db.salesReturn.findMany({ where: { tenantId: ctx.tenantId, branchId: ctx.branchId, at: { gte: since } }, select: { userId: true, at: true, amountPaise: true } }),
    db.shift.findMany({ where: { tenantId: ctx.tenantId, branchId: ctx.branchId, closedAt: { gte: since } } }),
    db.stockCount.findMany({ where: { tenantId: ctx.tenantId, branchId: ctx.branchId, at: { gte: since } } }),
    db.user.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } }),
    db.auditEvent.findMany({ where: { tenantId: ctx.tenantId, action: "Anomaly reviewed", at: { gte: new Date(Date.now() - 30 * 86400_000) } }, select: { entityId: true, userName: true, at: true } }),
    db.auditEvent.findMany({ where: { tenantId: ctx.tenantId, action: { in: ["Signed in", "Signed in with MFA"] }, at: { gte: since } }, select: { id: true, userName: true, at: true, detail: true } }),
    db.$queryRaw<{ medicineId: string; prev: bigint; cur: bigint; name: string; at: Date }[]>`
      WITH r AS (SELECT gi."medicineId", gi."ratePaise", g."approvedAt", ROW_NUMBER() OVER (PARTITION BY gi."medicineId" ORDER BY g."approvedAt" DESC) n
        FROM "GrnItem" gi JOIN "Grn" g ON g.id = gi."grnId" WHERE g."tenantId" = ${ctx.tenantId})
      SELECT a."medicineId", b."ratePaise" prev, a."ratePaise" cur, m.name, a."approvedAt" at FROM r a JOIN r b ON a."medicineId" = b."medicineId" AND b.n = 2 JOIN "Medicine" m ON m.id = a."medicineId"
      WHERE a.n = 1 AND a."approvedAt" >= ${since} AND a."ratePaise" > b."ratePaise" * 1.03`,
  ]);
  const name = (id: string) => users.find((u) => u.id === id)?.name ?? "Unknown";
  const out: { key: string; rule: string; detail: string; who: string; sev: "amber" | "red" | "gray"; at: string }[] = [];
  for (const s of sales) out.push({ key: "disc:" + s.id, rule: `Discount above ${th.disc}%`, detail: `${Number(s.discountPct)}% on ${s.invoiceNo}`, who: name(s.userId), sev: "amber", at: s.at.toISOString() });
  const perDay = new Map<string, number>();
  for (const r of returns) { const k = r.userId + "|" + new Date(r.at.getTime() + 330 * 60000).toISOString().slice(0, 10); perDay.set(k, (perDay.get(k) ?? 0) + 1); }
  for (const [k, n] of perDay) if (n > th.refunds) { const [u, d] = k.split("|"); out.push({ key: "ref:" + k, rule: `More than ${th.refunds} refunds in a day`, detail: `${n} credit notes on ${d}`, who: name(u), sev: "red", at: d + "T12:00:00Z" }); }
  for (const s of shifts) { const diff = big(s.countedPaise) - big(s.expectedPaise); if (Math.abs(diff) > th.cash * 100) out.push({ key: "cash:" + s.id, rule: `Cash difference above ₹${th.cash}`, detail: `${inr(diff)} at shift close`, who: name(s.closedBy ?? ""), sev: "red", at: s.closedAt!.toISOString() }); }
  for (const c of counts) { const v = (c.lines as { valuePaise: number }[]).reduce((a, l) => a + l.valuePaise, 0); if (Math.abs(v) > 50000) out.push({ key: "count:" + c.id, rule: "Stock count variance above ₹500", detail: `${inr(v)} in ${c.no}`, who: name(c.userId), sev: "amber", at: c.at.toISOString() }); }
  for (const c of cost) out.push({ key: "cost:" + c.medicineId + ":" + c.at.toISOString(), rule: "Purchase cost up more than 3%", detail: `${c.name} ${inr(Number(c.prev))} → ${inr(Number(c.cur))} (+${((Number(c.cur - c.prev) / Number(c.prev)) * 100).toFixed(1)}%)`, who: "Supplier pricing", sev: "gray", at: c.at.toISOString() });
  for (const s of signins) { const h = new Date(s.at.getTime() + 330 * 60000).getUTCHours(); if (h >= 23 || h < 6) out.push({ key: "login:" + s.id, rule: "Sign-in outside store hours", detail: `${s.at.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}${s.detail ? " · " + s.detail : ""}`, who: s.userName ?? "", sev: "amber", at: s.at.toISOString() }); }
  return out.sort((a, b) => b.at.localeCompare(a.at)).map((a) => { const r = reviewed.find((x) => x.entityId === a.key); return { ...a, reviewed: r ? `Reviewed by ${r.userName}` : null }; });
}

export async function markReviewed(ctx: Ctx, key: string, label: string) {
  authorizeAny(ctx, "reports", "users");
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Anomaly reviewed", entity: "anomaly", entityId: key.slice(0, 200), detail: label.slice(0, 200) });
}

// ───────────── Seasonal demand from your own history ─────────────

/** Month multipliers per medicine from the last 24 months of sales. Needs 12+ months of history. */
export async function seasonal(ctx: Ctx, targetMonth: number) {
  const first = await db.sale.findFirst({ where: { tenantId: ctx.tenantId, branchId: ctx.branchId }, orderBy: { at: "asc" }, select: { at: true } });
  const months = first ? Math.floor((Date.now() - first.at.getTime()) / (30.4 * 86400_000)) : 0;
  if (months < 12) return { ready: false as const, months };
  const since = new Date(Date.now() - 730 * 86400_000);
  const rows = await db.$queryRaw<{ medicineId: string; m: number; q: bigint }[]>`
    SELECT si."medicineId", EXTRACT(MONTH FROM s.at AT TIME ZONE 'Asia/Kolkata')::int m, SUM(si.qty) q FROM "SaleItem" si JOIN "Sale" s ON s.id = si."saleId"
    WHERE s."tenantId" = ${ctx.tenantId} AND s."branchId" = ${ctx.branchId} AND s.at >= ${since} GROUP BY 1, 2`;
  const [meds, stock] = await Promise.all([db.medicine.findMany({ where: { tenantId: ctx.tenantId, active: true }, select: { id: true, name: true } }), sellableByMedicine(ctx.tenantId, ctx.branchId)]);
  const cur = new Date(startOfTodayIST().getTime() + 330 * 60000).getUTCMonth();
  const now = new Date();
  const cov = monthCoverage(new Date(Math.max(first!.at.getTime(), since.getTime())), now);
  const plan = meds.map((m) => {
    const sums = Array.from({ length: 12 }, (_, i) => Number(rows.find((r) => r.medicineId === m.id && r.m === i + 1)?.q ?? 0));
    const l = seasonalLine(sums, cov, targetMonth, cur);
    if (!l) return null;
    const st = stock.get(m.id) ?? 0, atStart = Math.max(0, Math.floor(st - l.consumed));
    return { id: m.id, name: m.name, lift: l.lift, expected: l.expected, stock: st, atStart, need: Math.max(0, l.expected - atStart), bars: l.bars };
  }).filter((x): x is NonNullable<typeof x> => !!x && x.lift >= 10).sort((a, b) => b.lift - a.lift);
  return { ready: true as const, months, plan };
}

