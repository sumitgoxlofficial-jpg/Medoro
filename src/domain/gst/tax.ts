import { isInterState, stateOf } from "@/domain/accounting/gst";

export type Party = { gstin?: string | null; stateCode?: string | null } | null | undefined;

/**
 * Place of supply and tax split for a sale. The buyer's state (explicit, else its GSTIN prefix) is the place
 * of supply when known; otherwise the seller's. A different state means IGST, else CGST + SGST (CGST = floor(tax/2)).
 */
export function saleTaxSplit(sellerGstin: string | null | undefined, buyer: Party, tax: number) {
  const seller = stateOf(null, sellerGstin);
  const buyerState = stateOf(buyer?.stateCode, buyer?.gstin);
  const inter = isInterState(seller, buyerState);
  const cgst = inter ? 0 : Math.floor(tax / 2);
  return { pos: buyerState ?? seller, inter, igst: inter ? tax : 0, cgst, sgst: inter ? 0 : tax - cgst, gstin: buyer?.gstin || null };
}

/**
 * Splits each line's tax into a first half (CGST) and the rest (SGST) so the halves add up to `total`,
 * the CGST booked for the whole document. Starts from floor(tax/2) per line and moves single paise.
 */
export function allocateHalves(taxes: number[], total: number): number[] {
  const out = taxes.map((t) => Math.floor(t / 2));
  let diff = total - out.reduce((a, x) => a + x, 0);
  for (let i = 0; diff !== 0 && i < taxes.length * 2; i++) {
    const k = i % taxes.length;
    if (diff > 0 && out[k] < taxes[k]) { out[k]++; diff--; } else if (diff < 0 && out[k] > 0) { out[k]--; diff++; }
  }
  return out;
}
