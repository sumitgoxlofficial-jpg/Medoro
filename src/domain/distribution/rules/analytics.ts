// Distribution intelligence (pure). Transparent statistics over the distributor's own records — no external data,
// no machine-learning claims. Each result carries the numbers it was computed from so a person can check it.
import { fit, horizon } from "@/domain/intelligence/forecast-model";

export type DailySeries = { start: string; values: number[] }; // oldest first, last entry = yesterday

const weekday = (iso: string) => new Date(iso + "T00:00:00Z").getUTCDay();

/** Demand forecast for the next `days` days with an 80% range, or null when history is too short. */
export function demandForecast(s: DailySeries, days: number) {
  const m = fit(s.values, weekday(s.start));
  if (!m) return null;
  const next = (weekday(s.start) + s.values.length) % 7;
  const h = horizon(m, days, next);
  return { daily: m.level, total: h.total, low: h.lo, high: h.hi, histDays: m.histDays };
}

/** Plain average daily sales over the last `window` days (used when the model has too little history). */
export const avgDaily = (s: DailySeries, window = 90) => {
  const w = s.values.slice(-window);
  return w.length ? w.reduce((a, b) => a + b, 0) / w.length : 0;
};

export type ReorderInput = {
  onHand: number; onOrder: number; reserved: number; dailyDemand: number; leadDays: number; coverDays: number; safetyDays: number; packSize: number; minOrder?: number;
};

/** Suggested purchase quantity (packs): enough for lead time + cover + safety stock, less what is on hand and on order. */
export function reorderQty(i: ReorderInput): { packs: number; reorderPoint: number; target: number } {
  const reorderPoint = Math.ceil(i.dailyDemand * (i.leadDays + i.safetyDays));
  const target = Math.ceil(i.dailyDemand * (i.leadDays + i.coverDays + i.safetyDays));
  const position = i.onHand + i.onOrder - i.reserved;
  if (position > reorderPoint || i.dailyDemand <= 0) return { packs: 0, reorderPoint, target };
  const units = Math.max(0, target - position);
  let packs = Math.ceil(units / Math.max(1, i.packSize));
  if (packs > 0 && i.minOrder) packs = Math.max(packs, i.minOrder);
  return { packs, reorderPoint, target };
}

/** Dead stock: stock on hand with no sale in `days` days (or never sold), valued at cost. */
export function isDeadStock(lastSale: string | null, today: string, onHand: number, days = 90) {
  if (onHand <= 0) return false;
  if (!lastSale) return true;
  return (Date.parse(today) - Date.parse(lastSale)) / 86400000 >= days;
}

export type ProfitRow = { revenue: number; cost: number; schemeCost: number; qty: number };
export function profitability(r: ProfitRow) {
  const gross = r.revenue - r.cost;
  return { gross, grossPct: r.revenue ? Math.round((gross / r.revenue) * 10000) / 100 : null, net: gross - r.schemeCost };
}

/**
 * Scheme profitability: sales during the scheme against the same-length period before it, net of the scheme's cost.
 * `uplift` is incremental gross margin minus scheme cost; negative means the scheme lost money.
 */
export function schemeImpact(i: { before: { qty: number; margin: number }; during: { qty: number; margin: number }; schemeCost: number }) {
  const extraMargin = i.during.margin - i.before.margin;
  return { qtyChangePct: i.before.qty ? Math.round(((i.during.qty - i.before.qty) / i.before.qty) * 1000) / 10 : null, extraMargin, uplift: extraMargin - i.schemeCost };
}

export type RiskInput = { limit: number; balance: number; overdue: number; oldestDays: number; creditDays: number; bounces90d: number; paidLast90: number; billedLast90: number };
export type Risk = { score: number; level: "low" | "medium" | "high"; factors: string[] };

/** Credit risk 0–100 (higher = riskier) from limit use, overdue share, age past terms, bounces and collection rate. */
export function creditRisk(i: RiskInput): Risk {
  const f: string[] = [];
  let s = 0;
  const util = i.limit > 0 ? i.balance / i.limit : i.balance > 0 ? 1.5 : 0;
  if (util > 1) { s += 30; f.push(`Over limit (${Math.round(util * 100)}% used)`); } else if (util > 0.8) { s += 15; f.push(`${Math.round(util * 100)}% of limit used`); }
  const od = i.balance > 0 ? i.overdue / i.balance : 0;
  if (od > 0.5) { s += 25; f.push(`${Math.round(od * 100)}% of dues overdue`); } else if (od > 0.2) { s += 12; f.push(`${Math.round(od * 100)}% of dues overdue`); }
  const late = i.oldestDays - i.creditDays;
  if (late > 60) { s += 25; f.push(`Oldest bill ${late} days past terms`); } else if (late > 15) { s += 12; f.push(`Oldest bill ${late} days past terms`); }
  if (i.bounces90d > 0) { s += Math.min(20, i.bounces90d * 10); f.push(`${i.bounces90d} bounced cheque(s) in 90 days`); }
  const rate = i.billedLast90 > 0 ? i.paidLast90 / i.billedLast90 : 1;
  if (rate < 0.5) { s += 15; f.push(`Paid ${Math.round(rate * 100)}% of 90-day billing`); }
  s = Math.min(100, s);
  return { score: s, level: s >= 50 ? "high" : s >= 25 ? "medium" : "low", factors: f };
}

/** Linear trend of monthly sales for the next month (least squares); null with under 3 months. */
export function nextMonthTrend(months: number[]): { next: number; slope: number } | null {
  const n = months.length;
  if (n < 3) return null;
  const xs = months.map((_, i) => i), mx = (n - 1) / 2, my = months.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  for (let i = 0; i < n; i++) { num += (xs[i] - mx) * (months[i] - my); den += (xs[i] - mx) ** 2; }
  const slope = den ? num / den : 0;
  return { next: Math.max(0, Math.round(my + slope * (n - mx))), slope };
}
