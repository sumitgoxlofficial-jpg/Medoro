import "server-only";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorize, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { big } from "@/lib/money";
import { applyMapping, autoMapping, EBILL_FIELDS, missingFields, nameKey, nameScore, readEbillTable, resolveMapping, type EbillDraft, type EbillField, type EbillLine, type EbillMapping } from "./ebill";

export const EBILL_MAX_BYTES = 2 * 1024 * 1024;

export type MatchedLine = EbillLine & { medicineId: string | null; matchedBy: "barcode" | "code" | "learned" | "name" | null; confidence: number; catalogueGst: number | null };
export type EbillResult =
  | { needsMapping: true; preview: string[][]; mapping: EbillMapping; missing: string[] }
  | { needsMapping: false; preview: string[][]; mapping: EbillMapping; draft: Omit<EbillDraft, "lines"> & { lines: MatchedLine[] } };

function cleanMapping(raw: unknown, width: number): EbillMapping {
  const m = raw as EbillMapping;
  const cols: Partial<Record<EbillField, number>> = {};
  for (const f of Object.keys(EBILL_FIELDS) as EbillField[]) {
    const v = m?.cols?.[f];
    if (Number.isInteger(v) && v! >= 0 && v! < width) cols[f] = v;
  }
  const headerRow = Number.isInteger(m?.headerRow) && m.headerRow >= -1 && m.headerRow < 50 ? m.headerRow : -1;
  const rowFilter = m?.rowFilter && Number.isInteger(m.rowFilter.col) && typeof m.rowFilter.value === "string" && m.rowFilter.value.trim() ? { col: m.rowFilter.col, value: m.rowFilter.value.trim().slice(0, 10) } : null;
  return { headerRow, cols, rowFilter };
}

/**
 * Reads a distributor's digital bill for a GRN draft. Columns come from the mapping passed in, else the supplier's
 * saved mapping, else header detection. Lines are matched to the catalogue by barcode, then the supplier's item code,
 * then names learned from earlier GRNs, then fuzzy name + pack (which the user must confirm).
 */
export async function parseEbill(ctx: Ctx, supplierId: string, fileName: string, bytes: Uint8Array, mappingIn?: unknown, remember = false): Promise<EbillResult> {
  authorize(ctx, "purchase");
  if (bytes.length > EBILL_MAX_BYTES) throw new UserError("Bill file is larger than 2 MB.");
  const s = await db.supplier.findFirst({ where: { id: supplierId, tenantId: ctx.tenantId } });
  if (!s) throw new UserError("Choose the supplier first.");
  let t: string[][];
  try { t = readEbillTable(fileName, bytes); } catch (e) { throw new UserError(e instanceof Error ? e.message : "Couldn’t read the file."); }
  if (!t.length) throw new UserError("The file is empty.");
  const width = Math.max(...t.slice(0, 50).map((r) => r.length));
  const preview = t.slice(0, 12).map((r) => r.slice(0, 40).map((c) => c.slice(0, 60)));
  const given = mappingIn ? cleanMapping(mappingIn, width) : null;
  if (given && given.headerRow >= 0) given.names = Object.fromEntries(Object.entries(given.cols).map(([f, i]) => [f, t[given.headerRow]?.[i!] ?? ""]).filter(([, n]) => n));
  const m = given ?? (s.ebillMapping ? resolveMapping(t, s.ebillMapping as EbillMapping) : autoMapping(t));
  if (!m || missingFields(m).length) return { needsMapping: true, preview, mapping: m ?? { headerRow: -1, cols: {}, rowFilter: null }, missing: (m ? missingFields(m) : ["name", "batch", "expiry", "qty", "ptr"]).map((f) => EBILL_FIELDS[f as EbillField]) };
  const draft = applyMapping(t, m);
  if (!draft.lines.length) throw new UserError("No item lines found with this column mapping. Check the columns and the row filter.");

  const [meds, maps] = await Promise.all([
    db.medicine.findMany({ where: { tenantId: ctx.tenantId, active: true }, select: { id: true, name: true, strength: true, pack: true, barcode: true, gstRate: true, mrpPaise: true } }),
    db.supplierItemMap.findMany({ where: { tenantId: ctx.tenantId, supplierId: s.id } }),
  ]);
  const byCode = new Map(maps.map((x) => [x.code, x.medicineId]));
  const lines: MatchedLine[] = draft.lines.map((l) => {
    let medicineId: string | null = null, matchedBy: MatchedLine["matchedBy"] = null, confidence = 0;
    const bc = l.barcode && meds.find((m) => m.barcode === l.barcode);
    const viaCode = l.code ? byCode.get(l.code) : undefined, viaName = byCode.get(nameKey(l.name, l.pack));
    if (bc) { medicineId = bc.id; matchedBy = "barcode"; confidence = 1; }
    else if (viaCode && meds.some((m) => m.id === viaCode)) { medicineId = viaCode; matchedBy = "code"; confidence = 1; }
    else if (viaName && meds.some((m) => m.id === viaName)) { medicineId = viaName; matchedBy = "learned"; confidence = 1; }
    else {
      const best = meds.map((m) => ({ m, s: nameScore(l.name, l.pack, `${m.name} ${m.strength}`, m.pack) })).sort((a, b) => b.s - a.s)[0];
      if (best && best.s >= 0.5) { medicineId = best.m.id; matchedBy = "name"; confidence = Math.min(0.79, Math.round(best.s * 100) / 100); }
    }
    const med = meds.find((m) => m.id === medicineId);
    const problems = [...l.problems];
    if (med && l.gst != null && l.gst !== med.gstRate) problems.push(`Bill GST ${l.gst}% differs from catalogue ${med.gstRate}%`);
    if (med && l.mrp != null && l.mrp !== big(med.mrpPaise)) problems.push("MRP differs from catalogue (new MRP batch?)");
    return { ...l, problems, medicineId, matchedBy, confidence, catalogueGst: med?.gstRate ?? null };
  });
  if (given && remember) {
    await db.supplier.update({ where: { id: s.id }, data: { ebillMapping: given as object } });
    await writeAudit(db, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: "E-bill mapping saved", entity: "supplier", entityId: s.id, detail: `${s.name} · ${Object.keys(given.cols).join(", ")}` });
  }
  return { needsMapping: false, preview, mapping: m, draft: { ...draft, lines } };
}
