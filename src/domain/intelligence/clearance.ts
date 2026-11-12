// A discount to clear stock that won't sell before it expires, without selling below what it cost.
// Pure: prices are paise per pack; `cost` is the purchase cost per pack excluding GST, `mrp` includes GST.

/** Bigger discounts the closer expiry is. */
export const DISCOUNT_TIERS = [{ upToDays: 15, pct: 30 }, { upToDays: 30, pct: 20 }, { upToDays: 60, pct: 10 }, { upToDays: Infinity, pct: 5 }] as const;

export type Clearance = {
  /** Suggested discount on MRP, in percent (0 when even a small discount would sell below cost). */
  pct: number;
  /** Price per pack after the discount, paise (GST included). */
  price: number;
  /** The lowest price per pack that still covers the cost, paise (GST included). */
  floor: number;
  /** True when the suggested discount is held back by the cost floor. */
  limited: boolean;
};

export function clearance(a: { days: number; mrp: number; cost: number; gstRate: number }): Clearance {
  const floor = Math.ceil((a.cost * (100 + a.gstRate)) / 100); // whole-number maths: no 6720.000000000001
  const maxPct = a.mrp > 0 ? Math.max(0, Math.floor(((a.mrp - floor) / a.mrp) * 100)) : 0;
  const tier = DISCOUNT_TIERS.find((t) => a.days <= t.upToDays)!.pct;
  const pct = Math.min(tier, maxPct);
  return { pct, price: Math.round(a.mrp * (1 - pct / 100)), floor, limited: pct < tier };
}
