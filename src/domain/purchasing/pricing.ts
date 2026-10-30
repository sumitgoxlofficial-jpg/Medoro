// Purchase pricing for Indian pharma bills: PTR, free-goods schemes and discounts, GST and landed cost.
// All amounts are integer paise; percentages are converted to basis points before multiplying.

/**
 * What GST is computed on:
 * - "net": value after scheme, trade and cash discounts shown on the bill (CGST Act s.15(3)(a)). Default.
 * - "before_cd": after scheme and trade discounts, before cash discount (distributors who treat CD as a settlement discount).
 * - "gross": PTR × paid quantity, before any discount.
 * Free quantity is never taxed separately: it is part of the same supply (CBIC circular 92/11/2019).
 */
export const GST_BASES = ["net", "before_cd", "gross"] as const;
export type GstBase = (typeof GST_BASES)[number];
/** itc false: the pharmacy can't claim input GST (composition scheme), so GST is part of stock cost. */
export type PricingRules = { gstBase: GstBase; itc: boolean };
export const DEFAULT_RULES: PricingRules = { gstBase: "net", itc: true };

export function rulesOf(settings: unknown): PricingRules {
  const p = (settings as { purchasing?: Partial<PricingRules> } | null)?.purchasing;
  return { gstBase: p?.gstBase && (GST_BASES as readonly string[]).includes(p.gstBase) ? p.gstBase : "net", itc: p?.itc !== false };
}

/** "10+2", "10 + 2", "10+2F" → buy 10 get 2. */
export function parseScheme(s: string | null | undefined): { buy: number; free: number } | null {
  const m = (s ?? "").trim().match(/^(\d{1,5})\s*\+\s*(\d{1,5})\s*(f|free)?$/i);
  if (!m) return null;
  const buy = +m[1], free = +m[2];
  return buy > 0 && free > 0 ? { buy, free } : null;
}

/** Free units a scheme gives on a paid quantity: 25 on "10+2" → 4. */
export function schemeFree(qty: number, scheme: string | null | undefined) {
  const s = parseScheme(scheme);
  return s ? Math.floor(qty / s.buy) * s.free : 0;
}

const bp = (pct: number | undefined) => Math.round((Number.isFinite(pct) ? pct! : 0) * 100);
const pctOf = (v: number, pct: number | undefined) => Math.round((v * bp(pct)) / 10000);

export type PriceInput = { qty: number; freeQty?: number; rate: number; gstRate: number; schemePct?: number; tradePct?: number; cashPct?: number };
export type PricedLine = {
  gross: number; schemeDisc: number; tradeDisc: number; cashDisc: number; disc: number;
  /** Purchase value booked: paid quantity at PTR less all discounts. */
  net: number;
  /** Value GST is computed on. */
  taxable: number;
  gst: number;
  /** What the supplier bills for the line. */
  payable: number;
  /** Stock cost of the line: net, plus GST when it can't be claimed. */
  cost: number;
  units: number;
  /** Landed cost per unit, spread over paid + free units. */
  landed: number;
};

export function priceLine(l: PriceInput, rules: PricingRules = DEFAULT_RULES): PricedLine {
  const qty = Math.max(0, l.qty || 0), free = Math.max(0, l.freeQty || 0);
  const gross = qty * l.rate;
  const schemeDisc = pctOf(gross, l.schemePct);
  const tradeDisc = pctOf(gross - schemeDisc, l.tradePct);
  const afterTrade = gross - schemeDisc - tradeDisc;
  const cashDisc = pctOf(afterTrade, l.cashPct);
  const net = afterTrade - cashDisc;
  const taxable = rules.gstBase === "gross" ? gross : rules.gstBase === "before_cd" ? afterTrade : net;
  const gst = Math.round((taxable * l.gstRate) / 100);
  const cost = net + (rules.itc ? 0 : gst);
  const units = qty + free;
  return { gross, schemeDisc, tradeDisc, cashDisc, disc: gross - net, net, taxable, gst, payable: net + gst, cost, units, landed: units ? Math.round(cost / units) : 0 };
}

export function purchaseTotals(lines: PriceInput[], rules: PricingRules = DEFAULT_RULES) {
  const priced = lines.map((l) => priceLine(l, rules));
  const sum = (f: (p: PricedLine) => number) => priced.reduce((a, p) => a + f(p), 0);
  const net = sum((p) => p.net), gst = sum((p) => p.gst);
  return { lines: priced, gross: sum((p) => p.gross), disc: sum((p) => p.disc), net, taxable: sum((p) => p.taxable), gst, total: net + gst, cost: sum((p) => p.cost) };
}

/** Selling price excluding GST from an MRP (GST-inclusive). */
export const exGst = (mrp: number, gstRate: number) => Math.round((mrp * 100) / (100 + gstRate));

/** Margin % on selling price; null when there's no sale value. */
export const marginPct = (sell: number, cost: number) => (sell > 0 ? Math.round(((sell - cost) / sell) * 10000) / 100 : null);
