/**
 * Chain benchmarking rules (pure, tested). Money is paise.
 * - Growth compares net sales with the previous period of the same length (null when there was nothing to compare with).
 * - Stock turnover = cost of goods sold in the period, annualised, over the stock held now at cost. It uses today's stock
 *   because past stock levels are not snapshotted, so it is an approximation and labelled so.
 * - Stockout % = share of items with a reorder level set that have nothing sellable on the shelf right now.
 * - Expiry/write-off loss % = value written off at cost over net sales.
 */
export const growthPct = (cur: number, prev: number) => (prev > 0 ? Math.round(((cur - prev) / prev) * 1000) / 10 : null);
export const ratioPct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);
export const turnover = (cogs: number, periodDays: number, stockAtCost: number) => (stockAtCost > 0 && periodDays > 0 ? Math.round(((cogs * (365 / periodDays)) / stockAtCost) * 10) / 10 : null);

export type Direction = "high" | "low";
/** Rank 1 = best. Branches with no value are left unranked; ties share a rank; fewer than 2 values means no ranking at all. */
export function rank(values: (number | null)[], better: Direction): (number | null)[] {
  const have = values.filter((v): v is number => v != null);
  if (have.length < 2) return values.map(() => null);
  return values.map((v) => (v == null ? null : 1 + have.filter((o) => (better === "high" ? o > v : o < v)).length));
}

export function periodDays(fromDay: string, toDay: string) { return Math.round((Date.parse(toDay) - Date.parse(fromDay)) / 86400_000) + 1; }
export function previousPeriod(fromDay: string, toDay: string) {
  const n = periodDays(fromDay, toDay), d = (iso: string, k: number) => new Date(Date.parse(iso) + k * 86400_000).toISOString().slice(0, 10);
  return { fromDay: d(fromDay, -n), toDay: d(fromDay, -1), days: n };
}
