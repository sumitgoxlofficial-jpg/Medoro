/**
 * Profit intelligence rules (pure, tested). Money is paise.
 *
 * Gross profit here = net sales excluding GST (taxable value after discount, net of returns and voids) minus the landed cost
 * carried on each sale line. Landed cost is the batch cost set at GRN: purchase rate less scheme, trade and cash
 * discounts, spread over free goods, plus GST only where it can't be claimed as input credit (docs/PURCHASING.md).
 * It is never MRP minus a purchase price.
 */

/** Item-level sales and the ledger's net sales should agree. Small per-line rounding differences are normal. */
export const RECON_TOLERANCE = { paise: 100, ratio: 0.001 } as const;
export type Recon = { itemSales: number; ledgerSales: number; diff: number; status: "reconciled" | "differs" };
export function reconcile(itemSales: number, ledgerSales: number): Recon {
  const diff = itemSales - ledgerSales;
  const tol = Math.max(RECON_TOLERANCE.paise, Math.abs(ledgerSales) * RECON_TOLERANCE.ratio);
  return { itemSales, ledgerSales, diff, status: Math.abs(diff) <= tol ? "reconciled" : "differs" };
}

export const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : null);

/** Purchase-cost variation of one medicine over a window: spread between its cheapest and dearest landed cost, and how the latest compares with the average. */
export const COST_VARIATION_FLAG_PCT = 10;
export type CostVariation = { n: number; min: number; max: number; avg: number; latest: number; spreadPct: number; latestVsAvgPct: number; flagged: boolean };
export function costVariation(costsOldestFirst: number[]): CostVariation | null {
  const c = costsOldestFirst.filter((x) => x > 0);
  if (c.length < 2) return null;
  const min = Math.min(...c), max = Math.max(...c), avg = c.reduce((a, b) => a + b, 0) / c.length, latest = c[c.length - 1];
  const spreadPct = ((max - min) / min) * 100, latestVsAvgPct = ((latest - avg) / avg) * 100;
  return { n: c.length, min, max, avg: Math.round(avg), latest, spreadPct: Math.round(spreadPct * 10) / 10, latestVsAvgPct: Math.round(latestVsAvgPct * 10) / 10, flagged: spreadPct >= COST_VARIATION_FLAG_PCT };
}

/** A cashier is flagged for unusual discounting when their discount rate is at least 1.5× the pharmacy-wide rate over 20+ bills. */
export const DISCOUNT_FLAG = { ratio: 1.5, minBills: 20 } as const;
export type DiscountRow = { userId: string; bills: number; discountPaise: number; grossPaise: number };
export function flagDiscounts(rows: DiscountRow[]) {
  const disc = rows.reduce((a, r) => a + r.discountPaise, 0), gross = rows.reduce((a, r) => a + r.grossPaise, 0);
  const overall = gross > 0 ? disc / gross : 0;
  return {
    overallPct: pct(disc, gross),
    rows: rows.map((r) => {
      const rate = r.grossPaise > 0 ? r.discountPaise / r.grossPaise : 0;
      return { ...r, ratePct: pct(r.discountPaise, r.grossPaise), flagged: r.bills >= DISCOUNT_FLAG.minBills && overall > 0 && rate >= overall * DISCOUNT_FLAG.ratio };
    }),
  };
}
