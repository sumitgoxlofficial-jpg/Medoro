/**
 * Supplier intelligence: scoring and recommendation, as pure functions so the rules are testable and explainable.
 *
 * A supplier's score is a weighted mean of five factors, each 0-100:
 *   price       how close its documented landed cost is to the cheapest supplier of the same medicine
 *   fulfilment  share of ordered quantity actually received on its purchase orders
 *   delivery    share of received quantity that arrived within its lead time (+1 day grace)
 *   credit      credit days, capped at 60
 *   returns     whether it takes back near-expiry stock, and how wide its return window is (capped at 120 days)
 * A factor with no data is left out and the remaining weights are re-scaled, so missing history never counts as good
 * or bad; the result carries a confidence that says how much history is behind it.
 */
export const WEIGHTS = { price: 0.4, fulfilment: 0.2, delivery: 0.2, credit: 0.1, returns: 0.1 } as const;
export type FactorKey = keyof typeof WEIGHTS;

export type SupplierFacts = {
  orders: number; fillPct: number | null; onTimePct: number | null;
  creditDays: number; acceptsReturns: boolean; returnWindowDays: number;
};
export type Factor = { key: FactorKey; label: string; value: number | null; weight: number; points: number };
export type Score = { score: number; confidence: "high" | "medium" | "low"; factors: Factor[] };

const clamp = (n: number) => Math.max(0, Math.min(100, n));
const LABEL: Record<FactorKey, string> = { price: "Landed cost", fulfilment: "Fulfilment accuracy", delivery: "Delivery reliability", credit: "Credit period", returns: "Expiry return policy" };

/** 100 at the cheapest quote, falling 4 points per 1% dearer, 0 at 25% dearer. */
export const priceFactor = (ratioToBest: number | null) => (ratioToBest == null || !(ratioToBest > 0) ? null : clamp(100 - (ratioToBest - 1) * 400));
export const creditFactor = (days: number) => clamp((Math.min(Math.max(days, 0), 60) / 60) * 100);
export const returnsFactor = (accepts: boolean, windowDays: number) => (accepts ? clamp(20 + (Math.min(Math.max(windowDays, 0), 120) / 120) * 80) : 0);

export function scoreSupplier(f: SupplierFacts, ratioToBest: number | null): Score {
  const values: Record<FactorKey, number | null> = {
    price: priceFactor(ratioToBest),
    fulfilment: f.orders > 0 ? f.fillPct : null,
    delivery: f.orders > 0 ? f.onTimePct : null,
    credit: creditFactor(f.creditDays),
    returns: returnsFactor(f.acceptsReturns, f.returnWindowDays),
  };
  const keys = (Object.keys(WEIGHTS) as FactorKey[]).filter((k) => values[k] != null);
  const total = keys.reduce((s, k) => s + WEIGHTS[k], 0) || 1;
  const factors: Factor[] = (Object.keys(WEIGHTS) as FactorKey[]).map((k) => {
    const w = values[k] == null ? 0 : WEIGHTS[k] / total;
    return { key: k, label: LABEL[k], value: values[k] == null ? null : Math.round(values[k]!), weight: Math.round(w * 100) / 100, points: Math.round((values[k] ?? 0) * w * 10) / 10 };
  });
  const score = Math.round(factors.reduce((s, x) => s + x.points, 0));
  const confidence = f.orders >= 5 && values.price != null ? "high" : f.orders >= 2 && values.price != null ? "medium" : "low";
  return { score, confidence, factors };
}

export type Quote = { supplierId: string; name: string; landedPaise: number; at: string; facts: SupplierFacts };
export type Ranked = { supplierId: string; name: string; landedPaise: number; vsBestPct: number; score: Score };
export type Recommendation = { ranked: Ranked[]; pickId: string; explanation: string[]; cheaperButWorse: { name: string; savingPct: number } | null };

const rs = (paise: number) => `₹${(paise / 100).toFixed(2)}`;

/** Ranks the suppliers that quoted one medicine and explains the pick. Needs two or more quotes. */
export function recommend(quotes: Quote[]): Recommendation | null {
  const q = quotes.filter((x) => x.landedPaise > 0);
  if (q.length < 2) return null;
  const best = Math.min(...q.map((x) => x.landedPaise));
  const ranked: Ranked[] = q
    .map((x) => ({ supplierId: x.supplierId, name: x.name, landedPaise: x.landedPaise, vsBestPct: ((x.landedPaise - best) / best) * 100, score: scoreSupplier(x.facts, x.landedPaise / best) }))
    .sort((a, b) => b.score.score - a.score.score || a.landedPaise - b.landedPaise || a.name.localeCompare(b.name));
  const pick = ranked[0], cheapest = [...ranked].sort((a, b) => a.landedPaise - b.landedPaise)[0];
  const f = Object.fromEntries(pick.score.factors.map((x) => [x.key, x])) as Record<FactorKey, Factor>;
  const pf = q.find((x) => x.supplierId === pick.supplierId)!.facts;
  const out: string[] = [];
  const next = ranked.find((x) => x.supplierId !== pick.supplierId)!;
  out.push(pick.supplierId === cheapest.supplierId
    ? `Lowest landed cost: ${rs(pick.landedPaise)} per unit, ${(((next.landedPaise - pick.landedPaise) / next.landedPaise) * 100).toFixed(1)}% below ${next.name} (${rs(next.landedPaise)}).`
    : `Landed cost ${rs(pick.landedPaise)} per unit, ${pick.vsBestPct.toFixed(1)}% above the cheapest quote (${cheapest.name}, ${rs(cheapest.landedPaise)}).`);
  if (f.fulfilment.value != null) out.push(`${f.fulfilment.value}% of ordered quantity received and ${f.delivery.value}% on time, over ${pf.orders} order(s).`);
  else out.push("No completed purchase-order history yet, so reliability is not scored.");
  out.push(pf.creditDays ? `${pf.creditDays} days of credit.` : "No credit period.");
  out.push(pf.acceptsReturns ? `Takes back near-expiry stock (window ${pf.returnWindowDays} days).` : "Does not take expiry returns.");
  let cheaperButWorse: Recommendation["cheaperButWorse"] = null;
  if (cheapest.supplierId !== pick.supplierId) {
    const cf = q.find((x) => x.supplierId === cheapest.supplierId)!.facts;
    const saving = ((pick.landedPaise - cheapest.landedPaise) / pick.landedPaise) * 100;
    cheaperButWorse = { name: cheapest.name, savingPct: saving };
    out.push(`${cheapest.name} is ${saving.toFixed(1)}% cheaper but scores ${cheapest.score.score} against ${pick.score.score}: ${cf.orders ? `${cf.onTimePct ?? "n/a"}% on time and ${cf.fillPct ?? "n/a"}% fulfilled over ${cf.orders} order(s)` : "no order history"}, ${cf.creditDays}-day credit.`);
  }
  if (pick.score.confidence === "low") out.push("Low confidence: little order history behind this score. Treat it as a starting point, not a verdict.");
  return { ranked, pickId: pick.supplierId, explanation: out, cheaperButWorse };
}
