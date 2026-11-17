/**
 * Demand forecasting model (pure, tested). A transparent statistical baseline, not machine learning:
 *
 *  - level      mean daily demand over the last 28 days
 *  - weekday    factor per weekday from the last 8 weeks, shrunk towards 1 when there are few observations, mean 1
 *  - spread     standard deviation of the last 28 days' residuals around level × weekday factor
 *  - interval   an 80% range for a horizon total: total ± 1.28 × spread × √days (daily errors assumed independent)
 *  - seasonality is NOT modelled here: it needs 12+ months of history and the existing seasonal planner covers it
 *
 * Series are daily units, oldest first, the last entry being yesterday. A forecast needs 28+ days of history and 5+ days with
 * sales; with less, `forecast` returns null: "not enough data" is a result, never a zero.
 */
export const MIN_HISTORY_DAYS = 28;
export const MIN_SALES_DAYS = 5;
export const Z80 = 1.2816;
export const Z95 = 1.6449;

const mean = (a: number[]) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

export type Model = { level: number; factors: number[]; spread: number; histDays: number; salesDays: number; intermittency: number };
/** `startWeekday`: weekday (0 = Sunday) of series[0]. */
export function fit(series: number[], startWeekday: number): Model | null {
  const n = series.length, salesDays = series.filter((x) => x > 0).length;
  if (n < MIN_HISTORY_DAYS || salesDays < MIN_SALES_DAYS) return null;
  const win = series.slice(-56), off = n - win.length;
  const wd = (i: number) => (((startWeekday + off + i) % 7) + 7) % 7;
  const overall = mean(win);
  const factors = new Array<number>(7).fill(1);
  if (overall > 0) {
    for (let d = 0; d < 7; d++) {
      const obs = win.filter((_, i) => wd(i) === d);
      const raw = obs.length ? mean(obs) / overall : 1, w = Math.min(1, obs.length / 8);
      factors[d] = Math.min(2, Math.max(0.5, 1 + (raw - 1) * w));
    }
    const m = mean(factors);
    for (let d = 0; d < 7; d++) factors[d] /= m;
  }
  const recent = series.slice(-28), roff = n - 28;
  const level = mean(recent);
  const resid = recent.map((y, i) => y - level * factors[(((startWeekday + roff + i) % 7) + 7) % 7]);
  const spread = Math.sqrt(mean(resid.map((r) => r * r)));
  return { level, factors, spread, histDays: n, salesDays, intermittency: series.filter((x) => x === 0).length / n };
}

/** Point forecast for each of the next `h` days; `nextWeekday` is the weekday of the first forecast day. */
export const predictDaily = (m: Model, h: number, nextWeekday: number) => Array.from({ length: h }, (_, k) => Math.max(0, m.level * m.factors[(nextWeekday + k) % 7]));

export function horizon(m: Model, h: number, nextWeekday: number) {
  const total = predictDaily(m, h, nextWeekday).reduce((a, b) => a + b, 0), band = Z80 * m.spread * Math.sqrt(h);
  return { total, lo: Math.max(0, total - band), hi: total + band };
}

/** Rolling-origin backtest: from several past weeks, forecast the next 7 days from the data before them and compare. */
export function backtest(series: number[], startWeekday: number, weeks = 8) {
  let abs = 0, signed = 0, actual = 0, used = 0;
  const per: { predicted: number; actual: number; lo: number; hi: number }[] = [];
  for (let w = weeks; w >= 1; w--) {
    const cut = series.length - w * 7;
    if (cut < MIN_HISTORY_DAYS) continue;
    const m = fit(series.slice(0, cut), startWeekday);
    if (!m) continue;
    const h = horizon(m, 7, (startWeekday + cut) % 7), a = series.slice(cut, cut + 7).reduce((x, y) => x + y, 0);
    abs += Math.abs(h.total - a); signed += h.total - a; actual += a; used++;
    per.push({ predicted: h.total, actual: a, lo: h.lo, hi: h.hi });
  }
  return { weeks: used, wape: used && actual > 0 ? abs / actual : null, bias: used && actual > 0 ? signed / actual : null, coverage: used ? per.filter((p) => p.actual >= p.lo && p.actual <= p.hi).length / used : null, per };
}

export type Confidence = "high" | "medium" | "low";
/** How far to trust a forecast, from how much history there is and how well the method has done on this item's own past. */
export function confidenceOf(m: Model, wape: number | null): Confidence {
  if (wape == null) return "low";
  if (m.histDays >= 90 && wape <= 0.3) return "high";
  if (wape <= 0.6) return "medium";
  return "low";
}

/** Stock held against demand variability over the supplier's lead time, for a 95% service level. */
export const safetyStock = (spread: number, leadDays: number) => Math.ceil(Z95 * spread * Math.sqrt(Math.max(0, leadDays)));

export type Inbound = { day: number; qty: number }; // arrives `day` days from now
/** Day (1-based) the item runs out, with an early/late range from the interval; null when it lasts beyond `maxDays`. */
export function stockoutDay(stock: number, inbound: Inbound[], daily: number[], spread: number, maxDays = daily.length) {
  const find = (shift: number) => {
    let cum = 0;
    for (let k = 1; k <= Math.min(maxDays, daily.length); k++) {
      cum += daily[k - 1];
      const demand = Math.max(0, cum + shift * Z80 * spread * Math.sqrt(k)), supply = stock + inbound.filter((i) => i.day <= k).reduce((a, i) => a + i.qty, 0);
      if (supply - demand <= 0) return k;
    }
    return null;
  };
  return { point: find(0), early: find(1), late: find(-1) };
}

export type BatchLite = { id: string; qty: number; daysToExpiry: number };
/** First-expiry-first-out sell-through: units of each batch the forecast says will still be on hand when it expires. */
export function expiryRisk(batches: BatchLite[], daily: number[]) {
  const cum = (d: number) => daily.slice(0, Math.max(0, Math.min(d, daily.length))).reduce((a, b) => a + b, 0);
  let sold = 0;
  return [...batches].sort((a, b) => a.daysToExpiry - b.daysToExpiry).map((b) => {
    const s = Math.min(b.qty, Math.max(0, cum(b.daysToExpiry) - sold));
    sold += s;
    return { id: b.id, sells: Math.round(s * 10) / 10, unsold: Math.round((b.qty - s) * 10) / 10, horizonShort: b.daysToExpiry > daily.length };
  });
}
