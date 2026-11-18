/**
 * One medicine's forecast row and the scoring of past forecasts, as pure functions (no database), so the web screen
 * (forecast-intel.ts, PostgreSQL) and the counter (src/drivedb/forecast.ts, SQLite, for pharmacies whose records live in
 * their own Google Drive) produce the same numbers from the same inputs. The model itself is forecast-model.ts.
 */
import { backtest, confidenceOf, expiryRisk, fit, horizon, predictDaily, safetyStock, stockoutDay, type Confidence, type Inbound } from "./forecast-model";

export const METHOD = "statistical-v1";
export type Range = { point: number; lo: number; hi: number };
export type Rec = { qty: number; reason: string } | null;
export type LeadSource = "observed" | "supplier setting" | "counter default";
export type ForecastRow = {
  medicineId: string; name: string; confidence: Confidence; histDays: number;
  tomorrow: Range; week: Range; month: Range;
  weeklyActuals: number[]; backtest: { weeks: number; wape: number | null; bias: number | null; coverage: number | null };
  stock: number; inbound: number; leadDays: number; leadSource: LeadSource; safetyStock: number; reorderPoint: number;
  stockout: { point: number | null; early: number | null; late: number | null }; rec: Rec; supplierId: string | null; supplier: string | null; ratePaise: number;
  expiry: { unsoldPacks: number; valuePaise: number; batches: { batchNo: string; days: number; unsold: number }[] };
};
export type Portfolio = { wape: number | null; bias: number | null; coverage: number | null; items: number };

export type RowInput = {
  id: string; name: string;
  /** Daily packs sold, oldest first, ending yesterday; `startWeekday` is the weekday (0 = Sunday) of series[0]. */
  series: number[]; startWeekday: number; nextWeekday: number;
  /** Days of demand the order should cover (the pharmacy's policy). */
  cover: number;
  stock: number; inboundRows: Inbound[];
  lead: { days: number; source: LeadSource };
  batches: { id: string; batchNo: string; qty: number; daysToExpiry: number; costPaise: number }[];
  supplier: { id: string; name: string } | null; ratePaise: number;
};

const r1 = (x: number) => Math.round(x * 10) / 10;
const rnd = (x: { total: number; lo: number; hi: number }): Range => ({ point: r1(x.total), lo: r1(x.lo), hi: r1(x.hi) });

/** The forecast row for one medicine, or null when there is not enough history (a result of its own, never a zero). */
export function buildForecastRow(i: RowInput): { row: ForecastRow; bt: ReturnType<typeof backtest> } | null {
  const m = fit(i.series, i.startWeekday);
  if (!m) return null;
  const bt = backtest(i.series, i.startWeekday), conf = confidenceOf(m, bt.wape);
  const daily = predictDaily(m, 120, i.nextWeekday), cum = (k: number) => daily.slice(0, k).reduce((a, b) => a + b, 0);
  const ss = safetyStock(m.spread, i.lead.days), inbound = i.inboundRows.reduce((a, x) => a + x.qty, 0);
  const rop = Math.ceil(cum(i.lead.days) + ss), position = i.stock + inbound, target = Math.ceil(cum(i.lead.days + i.cover) + ss);
  const so = stockoutDay(i.stock, i.inboundRows, daily, m.spread);
  let rec: Rec = null;
  if (position <= rop) {
    const qty = Math.max(1, target - position);
    rec = { qty, reason: `${i.stock} in stock${inbound ? ` plus ${inbound} on order` : ""} is at or below the reorder point ${rop} (expected demand over the ${i.lead.days}-day lead time ${Math.ceil(cum(i.lead.days))}, plus ${ss} safety stock). Orders up to ${target}, which covers the lead time and ${i.cover} days.` };
  }
  const exp = expiryRisk(i.batches.map((b) => ({ id: b.id, qty: b.qty, daysToExpiry: b.daysToExpiry })), daily);
  const unsoldPacks = exp.reduce((a, e) => a + e.unsold, 0);
  const value = exp.reduce((a, e) => a + e.unsold * i.batches.find((b) => b.id === e.id)!.costPaise, 0);
  const wk = (k: number) => { const a = i.series.slice(i.series.length - 7 * (k + 1), i.series.length - 7 * k); return a.length === 7 ? r1(a.reduce((x, y) => x + y, 0)) : null; };
  const three = (x: number | null) => (x == null ? null : Math.round(x * 1000) / 1000);
  return {
    bt,
    row: {
      medicineId: i.id, name: i.name, confidence: conf, histDays: m.histDays,
      tomorrow: rnd(horizon(m, 1, i.nextWeekday)), week: rnd(horizon(m, 7, i.nextWeekday)), month: rnd(horizon(m, 30, i.nextWeekday)),
      weeklyActuals: [7, 6, 5, 4, 3, 2, 1, 0].map((k) => wk(k)).filter((x): x is number => x != null),
      backtest: { weeks: bt.weeks, wape: three(bt.wape), bias: three(bt.bias), coverage: bt.coverage },
      stock: i.stock, inbound, leadDays: i.lead.days, leadSource: i.lead.source, safetyStock: ss, reorderPoint: rop, stockout: so, rec,
      supplierId: i.supplier?.id ?? null, supplier: i.supplier?.name ?? null, ratePaise: i.ratePaise,
      expiry: { unsoldPacks: r1(unsoldPacks), valuePaise: Math.round(value), batches: exp.filter((e) => e.unsold >= 0.5).map((e) => { const b = i.batches.find((x) => x.id === e.id)!; return { batchNo: b.batchNo, days: b.daysToExpiry, unsold: e.unsold }; }) },
    },
  };
}

/** Most urgent first: soonest stock-out, then biggest order, then name. */
export const byUrgency = (a: ForecastRow, b: ForecastRow) => (a.stockout.point ?? 999) - (b.stockout.point ?? 999) || (b.rec?.qty ?? 0) - (a.rec?.qty ?? 0) || a.name.localeCompare(b.name);

/** The tested-on-own-history figures for a whole branch, weighted by units sold. */
export function portfolioOf(bts: ReturnType<typeof backtest>[]): Portfolio {
  const p = { abs: 0, signed: 0, act: 0, cov: 0, covN: 0, items: 0 };
  for (const bt of bts) {
    if (bt.wape != null) { const act = bt.per.reduce((a, x) => a + x.actual, 0); p.act += act; p.abs += bt.wape * act; p.signed += (bt.bias ?? 0) * act; p.items++; }
    if (bt.coverage != null) { p.cov += bt.coverage; p.covN++; }
  }
  const three = (x: number) => Math.round(x * 1000) / 1000;
  return { wape: p.act ? three(p.abs / p.act) : null, bias: p.act ? three(p.signed / p.act) : null, coverage: p.covN ? three(p.cov / p.covN) : null, items: p.items };
}

// ---------- scoring forecasts that were actually made ----------

export type Snap = { medicineId: string; generatedOn: string; predicted: number; lo: number; hi: number };
export type Accuracy = { weeks: { generatedOn: string; items: number; wape: number | null; bias: number | null; coverage: number | null }[]; overall: { items: number; wape: number | null; bias: number | null; coverage: number | null }; pendingWeeks: number };
type Acc = { abs: number; signed: number; act: number; hit: number; n: number };
const fmt = (w: Acc) => ({ items: w.n, wape: w.act ? Math.round((w.abs / w.act) * 1000) / 1000 : null, bias: w.act ? Math.round((w.signed / w.act) * 1000) / 1000 : null, coverage: w.n ? Math.round((w.hit / w.n) * 1000) / 1000 : null });

/**
 * Scores completed-week snapshots against what sold. `actual(medicineId, fromDay)` is the packs sold in the 7 days starting that day.
 * Snapshots are expected newest first; the newest 12 weeks are listed. Nothing is back-filled.
 */
export function scoreSnapshots(snaps: Snap[], actual: (medicineId: string, from: string) => number, pendingWeeks: number): Accuracy {
  if (!snaps.length) return { weeks: [], overall: { items: 0, wape: null, bias: null, coverage: null }, pendingWeeks };
  const byWeek = new Map<string, Acc>();
  for (const s of snaps) {
    const a = actual(s.medicineId, s.generatedOn), w = byWeek.get(s.generatedOn) ?? { abs: 0, signed: 0, act: 0, hit: 0, n: 0 };
    w.abs += Math.abs(s.predicted - a); w.signed += s.predicted - a; w.act += a; w.n++; if (a >= s.lo && a <= s.hi) w.hit++;
    byWeek.set(s.generatedOn, w);
  }
  const all = [...byWeek.values()].reduce((a, w) => ({ abs: a.abs + w.abs, signed: a.signed + w.signed, act: a.act + w.act, hit: a.hit + w.hit, n: a.n + w.n }), { abs: 0, signed: 0, act: 0, hit: 0, n: 0 });
  return { weeks: [...byWeek].map(([generatedOn, w]) => ({ generatedOn, ...fmt(w) })).slice(0, 12), overall: fmt(all), pendingWeeks };
}
