const IST = 330 * 60000;

/** How many of each calendar month (IST) fall inside [from, to), counting partial months as fractions. */
export function monthCoverage(from: Date, to: Date): number[] {
  const cov = new Array<number>(12).fill(0);
  const end = to.getTime() + IST;
  for (let t = from.getTime() + IST; t < end;) {
    const d = new Date(t), y = d.getUTCFullYear(), m = d.getUTCMonth();
    const start = Date.UTC(y, m, 1), next = Date.UTC(y, m + 1, 1);
    cov[m] += (Math.min(next, end) - t) / (next - start);
    t = next;
  }
  return cov;
}

/**
 * Seasonal outlook for one medicine. `sums` are units sold per calendar month over the window and `cov` how many
 * of each month the window held, so overlapping months in a 13–23 month history aren't double-counted.
 */
export function seasonalLine(sums: number[], cov: number[], target: number, cur: number) {
  const rate = sums.map((q, i) => (cov[i] > 0 ? q / cov[i] : 0));
  const avg = rate.reduce((a, b) => a + b, 0) / 12;
  if (!avg) return null;
  const ahead = (target - cur + 12) % 12 || 12;
  let consumed = 0;
  for (let k = 0; k < ahead; k++) consumed += rate[(cur + k) % 12] * (k === 0 ? 0.5 : 1);
  return { lift: (rate[target] / avg - 1) * 100, expected: Math.ceil(rate[target]), consumed, bars: rate.map((v) => v / avg) };
}