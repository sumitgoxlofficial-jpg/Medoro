// Wholesale pricing and GST. Indian pharma wholesale bills on a rate per pack (PTR/PTS or a special rate) that
// EXCLUDES GST; discounts reduce the taxable value and GST is added on top, line by line. Free goods from a scheme
// go out at zero value (no tax on them: the scheme is a pre-agreed discount, CBIC circular 92/11/2019-GST).
// All money is integer paise.

export type WholesaleLineInput = {
  qty: number; // paid packs
  freeQty?: number; // scheme free packs
  rate: number; // paise per pack, ex-GST
  gstRate: number; // 0, 5, 12, 18
  discPct?: number; // trade / cash / scheme discount %, applied to rate × qty
};

export type WholesaleLine = {
  qty: number; freeQty: number; rate: number; gstRate: number; discPct: number;
  gross: number; // rate × qty
  disc: number;
  taxable: number;
  tax: number;
  cgst: number; sgst: number; igst: number;
  total: number;
};

export type InvoiceTotals = {
  lines: WholesaleLine[];
  gross: number; disc: number; taxable: number; cgst: number; sgst: number; igst: number; tax: number;
  roundOff: number; total: number;
};

const r2 = (n: number) => Math.round(n * 100) / 100;

export function priceWholesaleLine(l: WholesaleLineInput, inter: boolean): WholesaleLine {
  if (!Number.isInteger(l.qty) || l.qty <= 0) throw new Error("Quantity must be a whole number above zero.");
  const freeQty = l.freeQty ?? 0;
  if (!Number.isInteger(freeQty) || freeQty < 0) throw new Error("Free quantity can’t be negative.");
  if (!Number.isInteger(l.rate) || l.rate < 0) throw new Error("Rate must be positive whole paise.");
  const discPct = r2(l.discPct ?? 0);
  if (discPct < 0 || discPct > 100) throw new Error("Discount must be between 0 and 100%.");
  if (![0, 3, 5, 12, 18, 28].includes(l.gstRate)) throw new Error(`GST rate ${l.gstRate}% isn’t a valid rate.`);
  const gross = l.rate * l.qty;
  const disc = Math.round((gross * discPct) / 100);
  const taxable = gross - disc;
  const tax = Math.round((taxable * l.gstRate) / 100);
  const cgst = inter ? 0 : Math.floor(tax / 2);
  const sgst = inter ? 0 : tax - cgst;
  const igst = inter ? tax : 0;
  return { qty: l.qty, freeQty, rate: l.rate, gstRate: l.gstRate, discPct, gross, disc, taxable, tax, cgst, sgst, igst, total: taxable + tax };
}

/** Invoice totals with round-off to the nearest rupee on its own line. */
export function invoiceTotals(lines: WholesaleLineInput[], inter: boolean): InvoiceTotals {
  if (!lines.length) throw new Error("Add at least one product.");
  const ls = lines.map((l) => priceWholesaleLine(l, inter));
  const sum = (k: keyof WholesaleLine) => ls.reduce((a, l) => a + (l[k] as number), 0);
  const taxable = sum("taxable"), tax = sum("tax");
  const exact = taxable + tax;
  const total = Math.round(exact / 100) * 100;
  return { lines: ls, gross: sum("gross"), disc: sum("disc"), taxable, cgst: sum("cgst"), sgst: sum("sgst"), igst: sum("igst"), tax, roundOff: total - exact, total };
}

/** Proportional share of a line's taxable value and tax for `qty` of its `total` packs (credit notes). */
export function shareOfLine(taxable: number, tax: number, qty: number, total: number) {
  if (qty <= 0 || qty > total) throw new Error("Return quantity is more than was billed.");
  return { taxable: Math.round((taxable * qty) / total), tax: Math.round((tax * qty) / total) };
}

/** Rate for a chemist: an unexpired special rate wins, otherwise the price tier (PTR or PTS). */
export function rateFor(p: { ptr: number; pts: number }, tier: string, special?: { rate: number; validTo: string | null } | null, today = new Date().toISOString().slice(0, 10)): number {
  if (special && (!special.validTo || special.validTo >= today)) return special.rate;
  return tier === "pts" && p.pts > 0 ? p.pts : p.ptr;
}

/** Retailer margin implied by selling at `mrp` (GST-inclusive) after buying at `rate` + GST. */
export function retailerMarginPct(mrp: number, rate: number, gstRate: number): number | null {
  if (mrp <= 0) return null;
  const landed = rate * (1 + gstRate / 100);
  return r2(((mrp - landed) / mrp) * 100);
}
