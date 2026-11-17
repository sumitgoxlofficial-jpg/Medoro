import { z } from "zod";
import { asEan13, gs1Check } from "@/lib/barcode";
import { FORMS, GST_RATES, SCHEDULES } from "./contracts";
import { compositionOf, normStrength, squash, similarity } from "./salts";

/**
 * Central catalogue rules (pure, tested). The catalogue is curated by Medoro staff, starts empty and carries no prices.
 * An entry is a draft until a staff member checks it against a named source and records that source and the date; only then
 * is it "verified" and offered to pharmacies for linking and updates.
 */
export const EDITABLE_FIELDS = ["brand", "generic", "composition", "strength", "form", "manufacturer", "packSize", "packLabel", "hsn", "gstRate", "schedule"] as const;
export type EditableField = (typeof EDITABLE_FIELDS)[number];
/** The fields a pharmacy may take from the catalogue. Never MRP, prices, rates, rack, reorder level, loose-sale setup or the barcode: those are the pharmacy's own. */
export const SYNC_FIELDS = ["generic", "composition", "strength", "form", "manufacturer", "hsn", "gstRate", "schedule"] as const;
export type SyncField = (typeof SYNC_FIELDS)[number];
/** Fields that change how a bill is taxed or how a medicine is controlled: shown with a warning before they are applied. */
export const SENSITIVE_FIELDS: readonly SyncField[] = ["hsn", "gstRate", "schedule"];

export const entrySchema = z.object({
  brand: z.string().trim().min(2, "Brand name is required.").max(120),
  generic: z.string().trim().min(2, "Generic / salt is required.").max(200),
  composition: z.string().trim().max(300).default(""),
  strength: z.string().trim().min(1, "Strength is required.").max(60),
  form: z.enum(FORMS),
  manufacturer: z.string().trim().min(2, "Manufacturer is required.").max(120),
  packSize: z.coerce.number().int("Units per pack must be a whole number.").min(1).max(10000).default(1),
  packLabel: z.string().trim().max(60).default(""),
  hsn: z.string().trim().regex(/^\d{4,8}$/, "HSN is 4–8 digits."),
  gstRate: z.coerce.number().refine((g) => (GST_RATES as readonly number[]).includes(g), "Choose a GST rate the system supports."),
  schedule: z.enum(SCHEDULES).default(""),
  source: z.string().trim().min(3, "Say where this entry comes from.").max(160),
  sourceRef: z.string().trim().max(200).optional(),
});
export type EntryInput = z.input<typeof entrySchema>;
export type Entry = z.output<typeof entrySchema>;

/** The salt key of an entry: from its composition if given, else its generic and strength (same logic as a pharmacy's own medicines). */
export const entrySaltKey = (e: { composition?: string; generic: string; strength: string }) => compositionOf({ composition: e.composition ?? "", generic: e.generic, strength: e.strength }).saltKey;

/** Identity of a product for duplicate checks: brand, salt, strength, form, manufacturer and pack size, ignoring case, spacing and punctuation. */
export function dedupeKeyOf(e: { brand: string; generic: string; composition?: string; strength: string; form: string; manufacturer: string; packSize?: number }) {
  return [squash(e.brand), entrySaltKey(e) ?? squash(e.generic), normStrength(e.strength), e.form.toLowerCase(), squash(e.manufacturer), e.packSize ?? 1].join("|");
}

/**
 * A barcode a pharmacy could trust globally: a GS1 number (EAN-8, UPC-A, EAN-13 or GTIN-14) with a correct check digit.
 * Pharmacy-internal codes (the "29…" labels Medoro prints) are not global and are refused.
 */
export function globalBarcode(code: string): { ok: true; code: string } | { ok: false; reason: string } {
  const c = code.trim();
  if (!/^\d+$/.test(c)) return { ok: false, reason: "A product barcode is digits only." };
  if (![8, 12, 13, 14].includes(c.length)) return { ok: false, reason: "Use an EAN-8, UPC-A, EAN-13 or GTIN-14 number." };
  if (gs1Check(c.slice(0, -1)) !== Number(c.at(-1))) return { ok: false, reason: "The check digit is wrong: re-read the barcode." };
  if (c.length === 13 && c.startsWith("29")) return { ok: false, reason: "Codes starting 29 are pharmacy-internal labels, not product barcodes." };
  return { ok: true, code: c.length === 12 ? (asEan13(c) ?? c) : c };
}

/** Brand-name similarity at which two entries with identical details are shown for a person to review (never merged automatically). */
export const DUP_SIMILARITY = 0.65;
export type DupPair = { a: string; b: string; reason: string; score: number };
type Dup = { gid: string; brand: string; generic: string; composition?: string; strength: string; form: string; manufacturer: string; packSize: number; dedupeKey: string };
/**
 * Likely duplicate entries: the same identity key (should be impossible for live entries), or the same salt, strength, form,
 * manufacturer and pack size with a brand spelling that is nearly the same (65%+ trigram similarity, which catches a transposed or dropped letter in a long name). Cheap enough for
 * thousands of entries because only entries sharing a salt key are compared.
 */
export function duplicatePairs(entries: Dup[]): DupPair[] {
  const by = new Map<string, Dup[]>();
  for (const e of entries) { const k = entrySaltKey(e) ?? squash(e.generic); by.set(k, [...(by.get(k) ?? []), e]); }
  const out: DupPair[] = [];
  for (const group of by.values()) {
    for (let i = 0; i < group.length; i++) for (let j = i + 1; j < group.length; j++) {
      const a = group[i], b = group[j];
      if (a.dedupeKey === b.dedupeKey) { out.push({ a: a.gid, b: b.gid, reason: "Same brand, salt, strength, form, manufacturer and pack size", score: 1 }); continue; }
      const same = normStrength(a.strength) === normStrength(b.strength) && a.form === b.form && squash(a.manufacturer) === squash(b.manufacturer) && a.packSize === b.packSize;
      const s = similarity(a.brand, b.brand);
      if (same && s >= DUP_SIMILARITY) out.push({ a: a.gid, b: b.gid, reason: `Same product details and a near-identical brand name (${Math.round(s * 100)}% alike)`, score: s });
    }
  }
  return out.sort((x, y) => y.score - x.score);
}

export type MatchKind = "barcode" | "exact" | "similar";
export type LocalMed = { id: string; name: string; generic: string; composition: string | null; strength: string; form: string; manufacturer: string; packSize: number; barcode: string | null };
export type CatEntry = Dup & { barcodes: string[]; status: string };
/** How a pharmacy's own medicine relates to central entries: a verified barcode is certain, an identical identity key is exact, a near-identical brand with the same details is only a suggestion to review. */
export function matchLocal(m: LocalMed, entries: CatEntry[]): { gid: string; kind: MatchKind; score: number }[] {
  const out: { gid: string; kind: MatchKind; score: number }[] = [];
  const key = dedupeKeyOf({ brand: m.name, generic: m.generic, composition: m.composition ?? undefined, strength: m.strength, form: m.form, manufacturer: m.manufacturer, packSize: m.packSize });
  const saltK = entrySaltKey({ composition: m.composition ?? undefined, generic: m.generic, strength: m.strength });
  for (const e of entries) {
    if (m.barcode && e.barcodes.includes(m.barcode)) { out.push({ gid: e.gid, kind: "barcode", score: 1 }); continue; }
    if (e.dedupeKey === key) { out.push({ gid: e.gid, kind: "exact", score: 1 }); continue; }
    const sameProduct = (saltK ?? squash(m.generic)) === (entrySaltKey(e) ?? squash(e.generic)) && normStrength(m.strength) === normStrength(e.strength) && m.form.toLowerCase() === e.form.toLowerCase() && squash(m.manufacturer) === squash(e.manufacturer);
    const s = similarity(m.name, e.brand);
    if (sameProduct && s >= 0.7) out.push({ gid: e.gid, kind: "similar", score: s });
  }
  const rank = { barcode: 0, exact: 1, similar: 2 } as const;
  return out.sort((a, b) => rank[a.kind] - rank[b.kind] || b.score - a.score).slice(0, 5);
}
