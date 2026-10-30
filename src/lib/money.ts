// Money is always integer paise. Never use floats for stored amounts.

export type Paise = number;

export const toPaise = (rupees: string | number): Paise => {
  const n = typeof rupees === "number" ? rupees : parseFloat(String(rupees).replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
};

const sign = (p: number) => (p < 0 ? "−" : "");

/** ₹1,234.50 */
export const inr = (p: Paise) =>
  sign(p) + "₹" + (Math.abs(p) / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** ₹1,235 (rounded to the rupee) */
export const inr0 = (p: Paise) => sign(p) + "₹" + Math.round(Math.abs(p) / 100).toLocaleString("en-IN");

/** Compact: ₹4.2L, ₹1.3Cr */
export const inrShort = (p: Paise) => {
  const r = Math.abs(p) / 100;
  if (r >= 1e7) return sign(p) + "₹" + (r / 1e7).toFixed(2) + "Cr";
  if (r >= 1e5) return sign(p) + "₹" + (r / 1e5).toFixed(1) + "L";
  return inr0(p);
};

export const big = (p: bigint | number | null | undefined): Paise => (p == null ? 0 : Number(p));

export type TaxLineInput = { mrpPaise: Paise; qty: number; gstRate: number; costPaise?: Paise };

export type TaxLine = {
  amount: Paise; // MRP × qty (GST-inclusive)
  discount: Paise;
  net: Paise; // amount − discount, GST-inclusive
  taxable: Paise;
  tax: Paise;
  cost: Paise;
};

export type CartTotals = {
  lines: TaxLine[];
  mrpTotal: Paise;
  discount: Paise;
  taxable: Paise;
  tax: Paise;
  cgst: Paise;
  sgst: Paise;
  net: Paise; // before rounding
  roundOff: Paise;
  total: Paise; // rounded to the rupee
  cost: Paise;
};

/** GST is back-calculated from the MRP-inclusive price: taxable = round(net × 100 / (100 + rate)). */
export const taxableFromInclusive = (net: Paise, gstRate: number): Paise => Math.round((net * 100) / (100 + gstRate));

/**
 * Totals for a cart. Discount % applies per line (rounded per line), CGST = floor(tax/2),
 * SGST = remainder, grand total rounded to the nearest rupee with a separate round-off.
 */
export function cartTotals(items: TaxLineInput[], discountPct: number): CartTotals {
  const d = Number.isFinite(discountPct) ? discountPct : 0;
  let mrpTotal = 0, discount = 0, taxable = 0, tax = 0, cost = 0;
  const lines = items.map((it) => {
    const amount = it.mrpPaise * it.qty;
    const dd = Math.round((amount * d) / 100);
    const net = amount - dd;
    const tb = taxableFromInclusive(net, it.gstRate);
    const c = (it.costPaise ?? 0) * it.qty;
    mrpTotal += amount; discount += dd; taxable += tb; tax += net - tb; cost += c;
    return { amount, discount: dd, net, taxable: tb, tax: net - tb, cost: c };
  });
  const net = mrpTotal - discount;
  const total = Math.round(net / 100) * 100;
  const cgst = Math.floor(tax / 2);
  return { lines, mrpTotal, discount, taxable, tax, cgst, sgst: tax - cgst, net, roundOff: total - net, total, cost };
}

/**
 * Share of `total` for `units` more of `qty`, after `done` were already taken. Allocates on the
 * cumulative count so repeated partial returns add up to exactly `total`, never more.
 */
export const shareOf = (total: Paise, qty: number, done: number, units: number): Paise =>
  Math.round((total * (done + units)) / qty) - Math.round((total * done) / qty);
