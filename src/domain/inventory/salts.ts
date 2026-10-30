// Salt / composition normalisation. Medicines with the same key (same salts at the same strengths, in any
// order) are substitutes. Kept dependency-free so the POS, imports and the offline page can share it.

export type Salt = { name: string; strength: string };

const UNIT: Record<string, string> = { mg: "mg", milligram: "mg", milligrams: "mg", mcg: "mcg", µg: "mcg", ug: "mcg", microgram: "mcg", g: "g", gm: "g", gram: "g", grams: "g", ml: "ml", iu: "iu", "%": "%", "%w/w": "%", "%w/v": "%" };

/** "650 MG" → "650mg", "0.50 mg" → "0.5mg", "1,000 mg" → "1000mg". Unknown units are kept lower-cased. */
export function normStrength(s: string): string {
  const t = s.trim().toLowerCase().replace(/,(?=\d{3})/g, "").replace(/\s+/g, "");
  const m = t.match(/^(\d+(?:\.\d+)?)([a-zµ%/.]*)$/);
  if (!m) return t;
  const num = m[1].includes(".") ? m[1].replace(/0+$/, "").replace(/\.$/, "") : m[1].replace(/^0+(?=\d)/, "");
  const unit = UNIT[m[2]] ?? m[2];
  return num + unit;
}

const cleanName = (s: string) => s.trim().replace(/\s+/g, " ").replace(/^[-–]+|[-–.]+$/g, "");

/** Splits "Paracetamol 500mg + Caffeine 25 mg" (also "," ";" "&") into salts. */
export function parseComposition(text: string): Salt[] {
  return text.split(/\s*(?:\+|,|;|&|\band\b)\s*/i).map((p) => p.trim()).filter(Boolean).map((p) => {
    const m = p.match(/^(.*?)[\s(]*(\d[\d,]*(?:\.\d+)?\s*(?:[a-zµ%]+(?:\/\s*\d*\.?\d*\s*[a-z]+)?)?)\)?$/i);
    return m && m[1].trim() ? { name: cleanName(m[1]), strength: normStrength(m[2]) } : { name: cleanName(p), strength: "" };
  }).filter((s) => s.name);
}

/** Salts from the medicine master fields: zips "Paracetamol + Caffeine" with "500 mg + 25 mg". */
export function saltsFrom(generic: string, strength: string): Salt[] {
  const names = generic.split(/\s*(?:\+|,|;|&|\/)\s*/).map(cleanName).filter(Boolean);
  const strengths = strength.split(/\s*(?:\+|,|;|\/)\s*/).map((s) => s.trim()).filter(Boolean);
  if (names.length === strengths.length) return names.map((name, i) => ({ name, strength: normStrength(strengths[i]) }));
  if (names.length === 1) return [{ name: names[0], strength: normStrength(strength) }];
  return names.map((name) => ({ name, strength: "" }));
}

export const compositionText = (salts: Salt[]) => salts.map((s) => (s.strength ? `${s.name} ${s.strength}` : s.name)).join(" + ");

/** Order-independent key: "caffeine 25mg + paracetamol 500mg". Null when there is nothing to match on. */
export function saltKey(salts: Salt[]): string | null {
  if (!salts.length) return null;
  return salts.map((s) => `${s.name.toLowerCase()}${s.strength ? " " + s.strength : ""}`).sort().join(" + ");
}

/** Composition and key for a medicine: an explicit composition wins, else generic + strength. */
export function compositionOf(m: { composition?: string | null; generic: string; strength: string }) {
  const salts = m.composition?.trim() ? parseComposition(m.composition) : saltsFrom(m.generic, m.strength);
  return { composition: salts.length ? compositionText(salts) : null, saltKey: saltKey(salts) };
}

/** Lower-case letters and digits only, for brand matching that ignores spaces: "Dolo-650" ≈ "dolo650". */
export const squash = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");

const grams = (s: string) => { const t = ` ${squash(s)} `; const g = new Set<string>(); for (let i = 0; i < t.length - 2; i++) g.add(t.slice(i, i + 3)); return g; };

/** Trigram similarity (0–1), the same idea as Postgres pg_trgm, for typo-tolerant search. */
export function similarity(a: string, b: string): number {
  const x = grams(a), y = grams(b);
  if (!x.size || !y.size) return 0;
  let n = 0;
  for (const g of x) if (y.has(g)) n++;
  return n / (x.size + y.size - n);
}

/** Splits "dolo650" / "para 500mg" into tokens that each have to match the brand, generic or composition. */
export const searchTokens = (term: string) =>
  term.toLowerCase().replace(/([a-z])(\d)/g, "$1 $2").replace(/(\d)([a-z])/g, "$1 $2").split(/[\s+,]+/).filter(Boolean).slice(0, 6);
