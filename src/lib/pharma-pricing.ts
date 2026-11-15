// PTR / PTS / margin maths for the free margin calculator. Amounts in paise (integers); rates and margins in percent.

export type MarginBasis = "selling" | "markup";

export type PricingInput = {
  mrpPaise: number;
  gstRate: number;
  retailerMargin: number;
  stockistMargin: number;
  /** "selling": margin as a share of the selling price (PTR = price × (1 − m)); "markup": on cost (PTR = price ÷ (1 + m)). */
  basis: MarginBasis;
  /** Strips (or packs) in the order, for totals. */
  qty: number;
};

export type Pricing = {
  /** MRP without GST: the retailer's taxable selling price. */
  base: number;
  ptr: number;
  ptrWithGst: number;
  pts: number;
  ptsWithGst: number;
  retailerProfit: number;
  stockistProfit: number;
  /** Retailer's profit as a % of the MRP without GST, and as a markup on PTR. */
  marginOnSale: number;
  markupOnCost: number;
  outputGst: number;
  inputGst: number;
  netGst: number;
  cgst: number;
  sgst: number;
  order: { cost: number; sales: number; profit: number; netGst: number };
};

const off = (price: number, pct: number, basis: MarginBasis) => (basis === "selling" ? price * (1 - pct / 100) : price / (1 + pct / 100));

/** Every figure for one strip at the given MRP, rounded to the paisa, plus totals for `qty` strips. */
export function pharmaPricing(i: PricingInput): Pricing {
  const base = Math.round((i.mrpPaise * 100) / (100 + i.gstRate));
  const ptr = Math.round(off(base, i.retailerMargin, i.basis));
  const pts = Math.round(off(ptr, i.stockistMargin, i.basis));
  const inputGst = Math.round((ptr * i.gstRate) / 100);
  const outputGst = i.mrpPaise - base;
  const cgst = Math.floor(outputGst / 2);
  const qty = Math.max(0, Math.floor(i.qty));
  return {
    base, ptr, ptrWithGst: ptr + inputGst, pts, ptsWithGst: pts + Math.round((pts * i.gstRate) / 100),
    retailerProfit: base - ptr, stockistProfit: ptr - pts,
    marginOnSale: base ? ((base - ptr) / base) * 100 : 0,
    markupOnCost: ptr ? ((base - ptr) / ptr) * 100 : 0,
    outputGst, inputGst, netGst: outputGst - inputGst, cgst, sgst: outputGst - cgst,
    order: { cost: (ptr + inputGst) * qty, sales: i.mrpPaise * qty, profit: (base - ptr) * qty, netGst: (outputGst - inputGst) * qty },
  };
}
