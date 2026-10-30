// Multi-unit stock. Batch quantities are held in stock units: the smallest unit a medicine is sold in.
// A medicine with packSize 1 (the default) keeps stock in whole packs. Prices stay per pack (MRP is printed
// per pack); a loose unit costs MRP ÷ packSize rounded down to the paisa, so loose sales never exceed MRP.

import type { Paise } from "./money";

export type SaleUnit = "pack" | "loose";

export type PackDef = { packSize: number; packUnit: string; looseUnit: string; allowLoose?: boolean; caseSize?: number; caseUnit?: string };

export const canSellLoose = (m: Pick<PackDef, "packSize" | "allowLoose">) => !!m.allowLoose && m.packSize > 1;

/** Stock units used by `qty` of a unit. */
export const baseQty = (qty: number, unit: SaleUnit | undefined, packSize: number) => (unit === "loose" ? qty : qty * packSize);

/** Price of one sold unit: the pack MRP, or MRP ÷ pack size rounded down for a loose unit. */
export const unitPrice = (packPaise: Paise, unit: SaleUnit | undefined, packSize: number): Paise =>
  unit === "loose" && packSize > 1 ? Math.floor(packPaise / packSize) : packPaise;

/** Cost of one sold unit (per-pack cost spread over the pack), to the nearest paisa. */
export const unitCost = (packPaise: Paise, unit: SaleUnit | undefined, packSize: number): Paise =>
  unit === "loose" && packSize > 1 ? Math.round(packPaise / packSize) : packPaise;

/** Value of `units` stock units at a per-pack rate. */
export const stockValue = (packPaise: Paise, units: number, packSize: number): Paise =>
  packSize > 1 ? Math.round((packPaise * units) / packSize) : packPaise * units;

/** Whole packs and the loose remainder: 47 tabs in strips of 15 → 3 strips + 2. */
export function splitQty(units: number, packSize: number) {
  const s = units < 0 ? -1 : 1, a = Math.abs(units);
  return { sign: s, packs: Math.floor(a / Math.max(1, packSize)), loose: a % Math.max(1, packSize) };
}

const plural = (n: number, w: string) => (n === 1 || !w || /s$/i.test(w) ? w : w + "s");

/** "3 strips + 2 tabs" for a stock-unit quantity; plain "47" for medicines kept in packs. */
export function fmtQty(units: number, m: Pick<PackDef, "packSize" | "packUnit" | "looseUnit">): string {
  if (m.packSize <= 1) return String(units);
  const { sign, packs, loose } = splitQty(units, m.packSize);
  const parts = [packs ? `${packs} ${plural(packs, m.packUnit)}` : "", loose ? `${loose} ${plural(loose, m.looseUnit)}` : ""].filter(Boolean);
  return (sign < 0 ? "−" : "") + (parts.join(" + ") || `0 ${plural(0, m.packUnit)}`);
}

/** Sold-unit quantity with its label: "2 strips", "5 tabs", or "2" for pack-only medicines. */
export function fmtSold(qty: number, unit: SaleUnit | undefined, m: Pick<PackDef, "packSize" | "packUnit" | "looseUnit">): string {
  if (unit === "loose") return `${qty} ${plural(qty, m.looseUnit)}`;
  return m.packSize > 1 ? `${qty} ${plural(qty, m.packUnit)}` : String(qty);
}

/** "1 box = 10 strips · 1 strip = 15 tabs" */
export function packLabel(m: PackDef): string {
  const parts = [];
  if ((m.caseSize ?? 1) > 1) parts.push(`1 ${m.caseUnit ?? "box"} = ${m.caseSize} ${plural(m.caseSize!, m.packUnit)}`);
  if (m.packSize > 1) parts.push(`1 ${m.packUnit} = ${m.packSize} ${plural(m.packSize, m.looseUnit)}`);
  return parts.join(" · ");
}

/** Stock units as typed in a count or adjustment box: "3+2" (packs + loose), or "3" when there is no remainder. */
export const qtyInput = (units: number, packSize: number) => {
  if (packSize <= 1) return String(units);
  const { packs, loose } = splitQty(units, packSize);
  return loose ? `${packs}+${loose}` : String(packs);
};

/** Parses "3+2" (packs + loose) or "3" (packs) into stock units. Returns null if unreadable. */
export function parseQty(s: string, packSize: number): number | null {
  const t = s.trim();
  const ps = Math.max(1, packSize);
  let m: RegExpMatchArray | null;
  if ((m = t.match(/^(\d+)\s*\+\s*(\d+)$/))) {
    const packs = Number(m[1]), loose = Number(m[2]);
    return ps > 1 && loose < ps ? packs * ps + loose : null;
  }
  return /^\d+$/.test(t) ? Number(t) * ps : null;
}
