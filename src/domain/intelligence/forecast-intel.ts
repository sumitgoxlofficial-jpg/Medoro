import "server-only";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorize, authorizeView, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { big } from "@/lib/money";
import { addDays, dateOnly, istDate, istMidnight, todayISO } from "@/lib/dates";
import { sellableByMedicine } from "@/domain/inventory/queries";
import { createPo } from "@/domain/purchasing/service";
import { settings } from "./service";
import { backtest, confidenceOf, expiryRisk, fit, horizon, predictDaily, safetyStock, stockoutDay, type Confidence } from "./forecast-model";

/**
 * Demand forecasting and reorder recommendations for ONE branch, from that branch's own bills (packs, net of returns and voids).
 * It is a statistical estimate (forecast-model.ts), not a fact and not machine learning. Sales stop when stock runs out, so
 * the history under-states true demand for items that stocked out; the screen says so. A recommendation always carries its
 * confidence, and items without enough history get no forecast at all.
 */
export const METHOD = "statistical-v1";
const HISTORY_DAYS = 180, MAX_ROWS = 300, DAY = 86400_000;

export type Rec = { qty: number; reason: string } | null;
export type ForecastRow = {
  medicineId: string; name: string; confidence: Confidence; histDays: number;
  tomorrow: { point: number; lo: number; hi: number }; week: { point: number; lo: number; hi: number }; month: { point: number; lo: number; hi: number };
  weeklyActuals: number[]; backtest: { weeks: number; wape: number | null; bias: number | null; coverage: number | null };
  stock: number; inbound: number; leadDays: number; leadSource: "observed" | "supplier setting"; safetyStock: number; reorderPoint: number;
  stockout: { point: number | null; early: number | null; late: number | null }; rec: Rec; supplierId: string | null; supplier: string | null; ratePaise: number;
  expiry: { unsoldPacks: number; valuePaise: number; batches: { batchNo: string; days: number; unsold: number }[] };
};
export type ForecastIntel = {
  branch: { id: string; name: string }; generatedOn: string; policy: { cover: number; safety: number };
  rows: ForecastRow[]; insufficient: number; portfolio: { wape: number | null; bias: number | null; coverage: number | null; items: number };
};

function branchOf(ctx: Ctx, branchId: string | null) {
  const id = branchId ?? ctx.branchId, b = ctx.branches.find((x) => x.id === id);
  if (!b) throw new UserError("You don’t have access to that branch.");
  return b;
}
const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };

/** Daily pack demand per medicine, as dense arrays ending yesterday (IST). Zeros before the branch or the item existed are not demand and are cut off. */
async function history(tenantId: string, branchId: string, today: string) {
  const startDay = addDays(today, -HISTORY_DAYS), from = istMidnight(startDay), to = istMidnight(today);
  const [rows, first, stocked] = await Promise.all([
    db.$queryRaw<{ medicineId: string; day: Date; q: number }[]>`
      SELECT si."medicineId", (s.at + interval '330 minutes')::date AS day, SUM((si.qty - si."returnedQty")::float8 / CASE WHEN si.loose THEN si."packSize" ELSE 1 END) q
      FROM "SaleItem" si JOIN "Sale" s ON s.id = si."saleId"
      WHERE s."tenantId" = ${tenantId} AND s."branchId" = ${branchId} AND s.at >= ${from} AND s.at < ${to} GROUP BY 1, 2`,
    db.$queryRaw<{ d: Date | null }[]>`SELECT MIN(at) d FROM "Sale" WHERE "tenantId" = ${tenantId} AND "branchId" = ${branchId}`,
    db.$queryRaw<{ medicineId: string; d: Date }[]>`SELECT "medicineId", MIN("createdAt") d FROM "Batch" WHERE "tenantId" = ${tenantId} AND "branchId" = ${branchId} GROUP BY 1`,
  ]);
  const branchStart = first[0]?.d ? istDate(first[0].d) : today;
  const firstStock = new Map(stocked.map((s) => [s.medicineId, istDate(s.d)]));
  const byMed = new Map<string, Map<string, number>>();
  for (const r of rows) { const m = byMed.get(r.medicineId) ?? new Map(); m.set(r.day.toISOString().slice(0, 10), Number(r.q)); byMed.set(r.medicineId, m); }
  const out = new Map<string, { series: number[]; startWeekday: number }>();
  const recentFrom = addDays(today, -90);
  for (const [id, days] of byMed) {
    if (![...days.keys()].some((d) => d >= recentFrom)) continue;                   // nothing in the last 90 days: not an active item
    // Zeros before the item existed here are not demand. It existed from its first stock or its first sale, whichever is earlier
    // (stock may have been entered after sales already happened, for example after a data import).
    const firstSale = [...days.keys()].sort()[0], existed = [firstStock.get(id) ?? firstSale, firstSale].sort()[0];
    const start = [startDay, branchStart, existed].sort().at(-1)!;
    const n = Math.round((Date.parse(today) - Date.parse(start)) / DAY);
    const series = Array.from({ length: n }, (_, i) => days.get(addDays(start, i)) ?? 0);
    out.set(id, { series, startWeekday: new Date(start + "T00:00:00Z").getUTCDay() });
  }
  return out;
}

/** The forecasting engine for one branch, without a user: shared by the screen and the weekly snapshot job. */
export async function computeBranch(tenantId: string, branchId: string, now = new Date()): Promise<Omit<ForecastIntel, "branch">> {
  const today = todayISO(now), nextWeekday = new Date(today + "T00:00:00Z").getUTCDay();
  const [hist, stock, pol] = await Promise.all([history(tenantId, branchId, today), sellableByMedicine(tenantId, branchId), settings(tenantId)]);
  const ids = [...hist.keys()];
  const [meds, batches, sups, lastBatch, pos, firstGrn] = await Promise.all([
    db.medicine.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, strength: true, mrpPaise: true, packSize: true } }),
    db.batch.findMany({ where: { tenantId, branchId, medicineId: { in: ids }, qtyAvailable: { gt: 0 }, status: "ok", expiryDate: { gt: dateOnly(today) } }, select: { medicineId: true, batchNo: true, qtyAvailable: true, expiryDate: true, costPaise: true, id: true } }),
    db.supplier.findMany({ where: { tenantId }, select: { id: true, name: true, leadDays: true } }),
    db.batch.findMany({ where: { tenantId, branchId, supplierId: { not: null }, medicineId: { in: ids } }, orderBy: { createdAt: "desc" }, select: { medicineId: true, supplierId: true, costPaise: true } }),
    db.purchaseOrder.findMany({ where: { tenantId, branchId, status: { in: ["ordered", "partially_received"] } }, include: { items: true } }),
    db.$queryRaw<{ supplierId: string; poId: string; days: number }[]>`
      SELECT g."supplierId", g."poId", EXTRACT(EPOCH FROM (MIN(g."approvedAt") - po."placedAt")) / 86400 AS days FROM "Grn" g JOIN "PurchaseOrder" po ON po.id = g."poId"
      WHERE g."tenantId" = ${tenantId} AND g."branchId" = ${branchId} AND po."placedAt" IS NOT NULL GROUP BY g."supplierId", g."poId", po."placedAt"`,
  ]);
  const grnQty = await db.grnItem.groupBy({ by: ["poItemId"], where: { poItemId: { in: pos.flatMap((p) => p.items.map((i) => i.id)) } }, _sum: { qty: true } });
  const lead = (sid: string | null) => {
    const sup = sups.find((s) => s.id === sid), obs = firstGrn.filter((g) => g.supplierId === sid && g.days >= 0).map((g) => Number(g.days));
    return obs.length >= 3 ? { days: Math.max(1, Math.ceil(median(obs))), source: "observed" as const } : { days: sup ? Math.max(1, Math.ceil(Number(sup.leadDays))) : 1, source: "supplier setting" as const };
  };
  const rows: ForecastRow[] = []; let insufficient = 0;
  const port = { abs: 0, signed: 0, act: 0, cov: 0, covN: 0, items: 0 };
  for (const [id, h] of hist) {
    const m = fit(h.series, h.startWeekday), med = meds.find((x) => x.id === id);
    if (!med) continue;
    if (!m) { insufficient++; continue; }
    const bt = backtest(h.series, h.startWeekday), conf = confidenceOf(m, bt.wape);
    const lb = lastBatch.find((b) => b.medicineId === id), sup = sups.find((s) => s.id === lb?.supplierId) ?? null, ld = lead(sup?.id ?? null);
    const daily = predictDaily(m, 120, nextWeekday), cum = (k: number) => daily.slice(0, k).reduce((a, b) => a + b, 0);
    const st = stock.get(id) ?? 0, ss = safetyStock(m.spread, ld.days);
    const inboundRows = pos.filter((p) => p.items.some((i) => i.medicineId === id)).flatMap((p) => p.items.filter((i) => i.medicineId === id).map((i) => {
      const left = Math.max(0, i.qty - (grnQty.find((g) => g.poItemId === i.id)?._sum.qty ?? 0)), placed = p.placedAt ?? p.createdAt;
      return { day: Math.max(1, Math.ceil((placed.getTime() + lead(p.supplierId).days * DAY - now.getTime()) / DAY)), qty: left };
    })).filter((i) => i.qty > 0);
    const inbound = inboundRows.reduce((a, i) => a + i.qty, 0);
    const rop = Math.ceil(cum(ld.days) + ss), position = st + inbound;
    const target = Math.ceil(cum(ld.days + pol.policy.cover) + ss);
    const so = stockoutDay(st, inboundRows, daily, m.spread);
    let rec: Rec = null;
    if (position <= rop) {
      const qty = Math.max(1, target - position);
      rec = { qty, reason: `${st} in stock${inbound ? ` plus ${inbound} on order` : ""} is at or below the reorder point ${rop} (expected demand over the ${ld.days}-day lead time ${Math.ceil(cum(ld.days))}, plus ${ss} safety stock). Orders up to ${target}, which covers the lead time and ${pol.policy.cover} days.` };
    }
    const exp = expiryRisk(batches.filter((b) => b.medicineId === id).map((b) => ({ id: b.id, qty: b.qtyAvailable / med.packSize, daysToExpiry: Math.round((b.expiryDate.getTime() - Date.parse(today)) / DAY) })), daily);
    const cost = (b: { costPaise: bigint }) => big(b.costPaise);
    const unsoldPacks = exp.reduce((a, e) => a + e.unsold, 0);
    const value = exp.reduce((a, e) => a + e.unsold * cost(batches.find((b) => b.id === e.id)!), 0);
    const wk = (k: number) => { const a = h.series.slice(h.series.length - 7 * (k + 1), h.series.length - 7 * k); return a.length === 7 ? Math.round(a.reduce((x, y) => x + y, 0) * 10) / 10 : null; };
    const r1 = horizon(m, 1, nextWeekday), r7 = horizon(m, 7, nextWeekday), r30 = horizon(m, 30, nextWeekday);
    const rnd = (x: { total: number; lo: number; hi: number }) => ({ point: Math.round(x.total * 10) / 10, lo: Math.round(x.lo * 10) / 10, hi: Math.round(x.hi * 10) / 10 });
    rows.push({
      medicineId: id, name: `${med.name} ${med.strength}`.trim(), confidence: conf, histDays: m.histDays, tomorrow: rnd(r1), week: rnd(r7), month: rnd(r30),
      weeklyActuals: [7, 6, 5, 4, 3, 2, 1, 0].map((k) => wk(k)).filter((x): x is number => x != null), backtest: { weeks: bt.weeks, wape: bt.wape == null ? null : Math.round(bt.wape * 1000) / 1000, bias: bt.bias == null ? null : Math.round(bt.bias * 1000) / 1000, coverage: bt.coverage },
      stock: st, inbound, leadDays: ld.days, leadSource: ld.source, safetyStock: ss, reorderPoint: rop, stockout: so, rec, supplierId: sup?.id ?? null, supplier: sup?.name ?? null,
      ratePaise: lb ? cost(lb) : Math.round(big(med.mrpPaise) * 0.7), expiry: { unsoldPacks: Math.round(unsoldPacks * 10) / 10, valuePaise: Math.round(value), batches: exp.filter((e) => e.unsold >= 0.5).map((e) => { const b = batches.find((x) => x.id === e.id)!; return { batchNo: b.batchNo, days: Math.round((b.expiryDate.getTime() - Date.parse(today)) / DAY), unsold: e.unsold }; }) },
    });
    if (bt.wape != null) { const act = bt.per.reduce((a, p) => a + p.actual, 0); port.act += act; port.abs += bt.wape * act; port.signed += (bt.bias ?? 0) * act; port.items++; }
    if (bt.coverage != null) { port.cov += bt.coverage; port.covN++; }
  }
  rows.sort((a, b) => (a.stockout.point ?? 999) - (b.stockout.point ?? 999) || (b.rec?.qty ?? 0) - (a.rec?.qty ?? 0) || a.name.localeCompare(b.name));
  return { generatedOn: today, policy: pol.policy, rows: rows.slice(0, MAX_ROWS), insufficient, portfolio: { wape: port.act ? Math.round((port.abs / port.act) * 1000) / 1000 : null, bias: port.act ? Math.round((port.signed / port.act) * 1000) / 1000 : null, coverage: port.covN ? Math.round((port.cov / port.covN) * 1000) / 1000 : null, items: port.items } };
}

export async function forecastIntel(ctx: Ctx, branchId: string | null = null, now = new Date()): Promise<ForecastIntel> {
  authorizeView(ctx, "reports", "purchase");
  const b = branchOf(ctx, branchId);
  return { branch: { id: b.id, name: b.name }, ...(await computeBranch(ctx.tenantId, b.id, now)) };
}

/**
 * Stores this week's forecast for the branch (once per 7 days) so it can later be compared with what sold. Called by the
 * daily job for every branch; also safe to call by hand.
 */
export async function snapshotForecasts(tenantId: string, branchId: string, now = new Date()) {
  const today = todayISO(now);
  const recent = await db.forecastSnapshot.findFirst({ where: { tenantId, branchId, generatedOn: { gte: dateOnly(addDays(today, -6)) } }, select: { id: true } });
  if (recent) return 0;
  const r = await computeBranch(tenantId, branchId, now);
  const data = r.rows.map((x) => ({ tenantId, branchId, medicineId: x.medicineId, generatedOn: dateOnly(today), horizonDays: 7, predicted: x.week.point, lo: x.week.lo, hi: x.week.hi, confidence: x.confidence, method: METHOD }));
  if (!data.length) return 0;
  return (await db.forecastSnapshot.createMany({ data, skipDuplicates: true })).count;
}

export type Accuracy = { weeks: { generatedOn: string; items: number; wape: number | null; bias: number | null; coverage: number | null }[]; overall: { items: number; wape: number | null; bias: number | null; coverage: number | null }; pendingWeeks: number };

/** How the forecasts that were actually made performed once their week was over. Only completed weeks count; nothing is back-filled. */
export async function forecastAccuracy(ctx: Ctx, branchId: string | null = null, now = new Date()): Promise<Accuracy> {
  authorizeView(ctx, "reports", "purchase");
  const b = branchOf(ctx, branchId), today = todayISO(now), cutoff = addDays(today, -7);
  const snaps = await db.forecastSnapshot.findMany({ where: { tenantId: ctx.tenantId, branchId: b.id, generatedOn: { lte: dateOnly(cutoff) } }, orderBy: { generatedOn: "desc" }, take: 5000 });
  const pending = await db.forecastSnapshot.groupBy({ by: ["generatedOn"], where: { tenantId: ctx.tenantId, branchId: b.id, generatedOn: { gt: dateOnly(cutoff) } } });
  if (!snaps.length) return { weeks: [], overall: { items: 0, wape: null, bias: null, coverage: null }, pendingWeeks: pending.length };
  const oldest = snaps.at(-1)!.generatedOn.toISOString().slice(0, 10);
  const sold = await db.$queryRaw<{ medicineId: string; day: Date; q: number }[]>`
    SELECT si."medicineId", (s.at + interval '330 minutes')::date AS day, SUM((si.qty - si."returnedQty")::float8 / CASE WHEN si.loose THEN si."packSize" ELSE 1 END) q
    FROM "SaleItem" si JOIN "Sale" s ON s.id = si."saleId" WHERE s."tenantId" = ${ctx.tenantId} AND s."branchId" = ${b.id} AND s.at >= ${istMidnight(oldest)} GROUP BY 1, 2`;
  const actual = (med: string, from: string) => sold.filter((x) => x.medicineId === med && x.day.toISOString().slice(0, 10) >= from && x.day.toISOString().slice(0, 10) < addDays(from, 7)).reduce((a, x) => a + Number(x.q), 0);
  const byWeek = new Map<string, { abs: number; signed: number; act: number; hit: number; n: number }>();
  for (const s of snaps) {
    const key = s.generatedOn.toISOString().slice(0, 10), a = actual(s.medicineId, key), w = byWeek.get(key) ?? { abs: 0, signed: 0, act: 0, hit: 0, n: 0 };
    w.abs += Math.abs(s.predicted - a); w.signed += s.predicted - a; w.act += a; w.n++; if (a >= s.lo && a <= s.hi) w.hit++;
    byWeek.set(key, w);
  }
  const fmt = (w: { abs: number; signed: number; act: number; hit: number; n: number }) => ({ items: w.n, wape: w.act ? Math.round((w.abs / w.act) * 1000) / 1000 : null, bias: w.act ? Math.round((w.signed / w.act) * 1000) / 1000 : null, coverage: w.n ? Math.round((w.hit / w.n) * 1000) / 1000 : null });
  const all = [...byWeek.values()].reduce((a, w) => ({ abs: a.abs + w.abs, signed: a.signed + w.signed, act: a.act + w.act, hit: a.hit + w.hit, n: a.n + w.n }), { abs: 0, signed: 0, act: 0, hit: 0, n: 0 });
  return { weeks: [...byWeek].map(([generatedOn, w]) => ({ generatedOn, ...fmt(w) })).slice(0, 12), overall: fmt(all), pendingWeeks: pending.length };
}

/**
 * Draft purchase orders (never placed) from the recommendations, one per supplier, for the branch. Low-confidence items are left
 * out unless asked for; each order's note says it came from a statistical estimate and must be reviewed.
 */
export async function draftForecastOrders(ctx: Ctx, branchId: string | null, fallbackSupplierId: string | null, includeLow = false) {
  authorize(ctx, "purchase");
  const b = branchOf(ctx, branchId);
  if (b.id !== ctx.branchId) throw new UserError("Switch to that branch to draft its orders.");
  const f = await forecastIntel(ctx, b.id);
  const want = f.rows.filter((r) => r.rec && (includeLow || r.confidence !== "low"));
  const skipped = f.rows.filter((r) => r.rec && r.confidence === "low" && !includeLow).map((r) => r.name);
  if (!want.length) throw new UserError(skipped.length ? `Only low-confidence recommendations remain (${skipped.length}). Review them on the screen, or include them.` : "Nothing needs reordering.");
  const bySup = new Map<string, typeof want>();
  for (const r of want) {
    const s = r.supplierId ?? fallbackSupplierId;
    if (!s) throw new UserError(`${r.name} has no supplier on record. Choose a default supplier.`);
    bySup.set(s, [...(bySup.get(s) ?? []), r]);
  }
  const out: string[] = [];
  for (const [s, rs] of bySup) {
    const low = rs.filter((r) => r.confidence === "low").length;
    const po = await createPo(ctx, { supplierId: s, source: "forecast", note: `Statistical estimate, review before placing${low ? ` (${low} low-confidence line(s))` : ""}`.slice(0, 200), lines: rs.map((r) => ({ medicineId: r.medicineId, qty: r.rec!.qty, rate: r.ratePaise / 100 })) });
    out.push(po.no);
  }
  await writeAudit(db, { tenantId: ctx.tenantId, branchId: b.id, userId: ctx.userId, userName: ctx.userName, action: "Forecast draft orders created", entity: "purchase_order", detail: `${out.join(", ")} · ${want.length} line(s) · ${skipped.length} low-confidence left out` });
  return { orders: out, lines: want.length, skippedLowConfidence: skipped };
}
