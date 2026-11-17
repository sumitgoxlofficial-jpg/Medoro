/**
 * Customer intelligence rules, as pure functions so every threshold is visible and tested.
 * All dates are IST calendar days ("YYYY-MM-DD"); money is paise. Nothing here sends anything.
 *
 * Segments (first match wins):
 *   new        first purchase within the last 30 days
 *   lapsed     no purchase for longer than max(90 days, 3 × the customer's usual gap between visits)
 *   at_risk    no purchase for longer than 1.5 × the usual gap (needs a usual gap: two or more visit days)
 *   loyal      6 or more visit days in the last 12 months and not at risk
 *   regular    3 or more visit days in the last 12 months
 *   occasional everything else
 */
export const SEGMENTS = ["new", "loyal", "regular", "occasional", "at_risk", "lapsed"] as const;
export type Segment = (typeof SEGMENTS)[number];
export const SEGMENT_HELP: Record<Segment, string> = {
  new: "First purchase in the last 30 days",
  loyal: "6+ visit days in 12 months, buying on their usual rhythm",
  regular: "3+ visit days in 12 months",
  occasional: "Fewer than 3 visit days in 12 months",
  at_risk: "Overdue by more than 1.5× their usual gap between visits",
  lapsed: "No purchase for 90+ days and 3× their usual gap",
};

const DAY = 86400_000;
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

export type Purchase = { day: string; netPaise: number };
export type CustomerStats = {
  visits: number; purchases: number; firstDay: string; lastDay: string; recencyDays: number; usualGapDays: number | null;
  netPaise: number; avgBasketPaise: number; visits12m: number; spend12mPaise: number; monthlyPaise: number | null; value12mPaise: number | null;
  segment: Segment;
};

/** `purchases`: one entry per bill (voids removed, returns netted off); `today`: IST day. */
export function customerStats(purchases: Purchase[], today: string): CustomerStats | null {
  if (!purchases.length) return null;
  const days = [...new Set(purchases.map((p) => p.day))].sort();
  const gaps = days.slice(1).map((d, i) => daysBetween(days[i], d));
  const usualGapDays = gaps.length ? Math.max(1, Math.round(gaps.reduce((a, b) => a + b, 0) / gaps.length)) : null;
  const firstDay = days[0], lastDay = days[days.length - 1], recencyDays = Math.max(0, daysBetween(lastDay, today));
  const netPaise = purchases.reduce((s, p) => s + p.netPaise, 0);
  const recent = purchases.filter((p) => daysBetween(p.day, today) <= 365);
  const visits12m = new Set(recent.map((p) => p.day)).size;
  const spend12mPaise = recent.reduce((s, p) => s + p.netPaise, 0);
  const tenureDays = daysBetween(firstDay, today);
  // A projection of the CURRENT pattern, only with enough history to mean something: 3+ visit days over 90+ days.
  const enough = days.length >= 3 && tenureDays >= 90;
  const months = Math.min(12, Math.max(1, tenureDays / 30.4));
  const monthlyPaise = enough ? Math.round(spend12mPaise / months) : null;
  const segment: Segment =
    tenureDays <= 30 ? "new"
    : recencyDays > Math.max(90, 3 * (usualGapDays ?? 0)) ? "lapsed"
    : usualGapDays != null && recencyDays > 1.5 * usualGapDays ? "at_risk"
    : visits12m >= 6 ? "loyal"
    : visits12m >= 3 ? "regular" : "occasional";
  return { visits: days.length, purchases: purchases.length, firstDay, lastDay, recencyDays, usualGapDays, netPaise, avgBasketPaise: Math.round(netPaise / purchases.length), visits12m, spend12mPaise, monthlyPaise, value12mPaise: monthlyPaise == null ? null : monthlyPaise * 12, segment };
}

/** Month keys ("YYYY-MM") of the last n calendar months ending with the month of `today`, oldest first. */
export function lastMonths(today: string, n: number): string[] {
  const [y, m] = today.split("-").map(Number), out: string[] = [];
  for (let i = n - 1; i >= 0; i--) { const t = new Date(Date.UTC(y, m - 1 - i, 1)); out.push(t.toISOString().slice(0, 7)); }
  return out;
}

/**
 * Month-on-month retention: of the customers who bought in month M-1, the share who bought again in month M.
 * `byCustomer` maps a customer to the set of months they bought in. The first month has no previous month, so it has no rate.
 */
export function retention(byCustomer: Map<string, Set<string>>, months: string[]) {
  return months.map((month, i) => {
    if (i === 0) return { month, base: 0, kept: 0, rate: null as number | null };
    const prev = months[i - 1];
    let base = 0, kept = 0;
    for (const set of byCustomer.values()) if (set.has(prev)) { base++; if (set.has(month)) kept++; }
    return { month, base, kept, rate: base ? Math.round((kept / base) * 1000) / 10 : null };
  });
}
