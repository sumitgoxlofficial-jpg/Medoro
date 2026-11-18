// Trade schemes: "10+1" free goods, or an extra discount %, for a product or a whole company, within dates,
// optionally for named chemists only. The best scheme for the chemist (most value) applies to a line.

export type Scheme = {
  id: string; code: string; name: string; kind: "free" | "discount";
  medicineId: string | null; companyId: string | null;
  buyQty: number; freeQty: number; discPct: number; minQty: number;
  customerIds: string[]; validFrom: string; validTo: string; active: boolean;
};

export type SchemeResult = { schemeId: string | null; code: string | null; freeQty: number; discPct: number; label: string | null };

export const NO_SCHEME: SchemeResult = { schemeId: null, code: null, freeQty: 0, discPct: 0, label: null };

export function schemeApplies(s: Scheme, line: { medicineId: string; companyId: string | null; qty: number; customerId: string }, today: string): boolean {
  if (!s.active || today < s.validFrom || today > s.validTo) return false;
  if (s.medicineId ? s.medicineId !== line.medicineId : !(s.companyId && s.companyId === line.companyId)) return false;
  if (s.customerIds.length && !s.customerIds.includes(line.customerId)) return false;
  return line.qty >= Math.max(1, s.minQty);
}

/** Free packs for a buy-X-get-Y scheme on `qty` paid packs. */
export function freeFor(qty: number, buy: number, free: number): number {
  if (buy <= 0 || free <= 0) return 0;
  return Math.floor(qty / buy) * free;
}

/** Effective discount % a scheme is worth on this quantity (to compare a free scheme with a % scheme). */
export function schemeValuePct(s: Scheme, qty: number): number {
  if (s.kind === "discount") return Number(s.discPct);
  const f = freeFor(qty, s.buyQty, s.freeQty);
  return f ? (f / (qty + f)) * 100 : 0;
}

/** The best applicable scheme for a line. */
export function bestScheme(schemes: Scheme[], line: { medicineId: string; companyId: string | null; qty: number; customerId: string }, today: string): SchemeResult {
  let best: Scheme | null = null, bestV = 0;
  for (const s of schemes) {
    if (!schemeApplies(s, line, today)) continue;
    const v = schemeValuePct(s, line.qty);
    if (v > bestV + 1e-9 || (Math.abs(v - bestV) < 1e-9 && best && s.medicineId && !best.medicineId)) { best = s; bestV = v; }
  }
  if (!best || bestV <= 0) return NO_SCHEME;
  return best.kind === "free"
    ? { schemeId: best.id, code: best.code, freeQty: freeFor(line.qty, best.buyQty, best.freeQty), discPct: 0, label: `${best.buyQty}+${best.freeQty}` }
    : { schemeId: best.id, code: best.code, freeQty: 0, discPct: Number(best.discPct), label: `${Number(best.discPct)}% off` };
}

/** Scheme cost to the distributor: free goods at landed cost plus discount given. */
export function schemeCost(freeUnits: number, unitCost: number, discGiven: number) {
  return freeUnits * unitCost + discGiven;
}
