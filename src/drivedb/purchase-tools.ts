/**
 * Purchase tools on the device database (the counter's version of the web Purchases extras):
 *   - Supplier e-bills: the distributor's CSV / Excel / text export is read here with the same parser the server uses
 *     (src/domain/purchasing/ebill), lines are matched to the catalogue, and the bill is saved as a normal purchase
 *     (trade.recordPurchase), so stock, batches and supplier dues stay right. A file already entered is refused.
 *   - Pricing: how purchase GST and landed cost are worked out, margins on MRP, and each medicine's purchase rates.
 *   - Supplier claims: expiry / breakage returns. Stock leaves when the claim is raised; what the supplier is owed
 *     drops only when their credit note is recorded (a claimEvent "credit" row, counted by books.supplierDues).
 */
import { z } from "zod";
import { DriveDB } from "./client";
import { CounterError, type Medicine } from "./pharmacy";
import { recordPurchase } from "./trade";
import { applyMapping, autoMapping, EBILL_FIELDS, missingFields, nameKey, nameScore, readEbillTable, resolveMapping, REQUIRED_FIELDS, type EbillField, type EbillLine, type EbillMapping } from "@/domain/purchasing/ebill";
import { DEFAULT_RULES, exGst, GST_BASES, marginPct, priceLine, schemeFree, type PricingRules } from "@/domain/purchasing/pricing";
import { CLAIM_REASONS, CLAIM_STATUS, type ClaimReason } from "@/domain/inventory/claim-types";
import { stockValue } from "@/lib/units";
import { daysTo, fiscalYear, todayISO } from "@/lib/dates";

export { CLAIM_REASONS, CLAIM_STATUS, type ClaimReason };
const n = (v: unknown) => Number(v ?? 0);
const now = () => new Date().toISOString();
const id = z.string().min(1);
const pct = z.number().min(0).max(99.99).default(0);

// ---------- pricing rules ----------

/** The web's pricing rules plus the lowest margin the pharmacy wants on MRP (lines below it are flagged). */
export type CounterPricing = PricingRules & { minMarginPct: number };

export function pricingRules(db: DriveDB): CounterPricing {
  const r = db.from<{ gstBase: string; itc: number; minMarginPct: number }>("purchaseSetting").eq("id", "rules").first();
  if (!r) return { ...DEFAULT_RULES, minMarginPct: 0 };
  return { gstBase: (GST_BASES as readonly string[]).includes(r.gstBase) ? (r.gstBase as PricingRules["gstBase"]) : "net", itc: !!n(r.itc), minMarginPct: n(r.minMarginPct) };
}

export const pricingInput = z.object({ gstBase: z.enum(GST_BASES), itc: z.boolean(), minMarginPct: z.number().min(0, "Margin can’t be negative.").max(90).default(0) });

/** Saves the rules (synced to every counter). Bills already entered keep the values they were saved with. */
export function savePricingRules(db: DriveDB, input: z.input<typeof pricingInput>): CounterPricing {
  const r = pricingInput.parse(input);
  db.from("purchaseSetting").upsert({ id: "rules", gstBase: r.gstBase, itc: r.itc, minMarginPct: Math.round(r.minMarginPct * 100) / 100 });
  return pricingRules(db);
}

export type EbillCostInput = { qty: number; free: number; scheme: string; ptr: number | null; schemePct: number; discPct: number; cdPct: number; mrp?: number | null };

/**
 * One bill line priced with the rules. The counter keeps one rate per pack before GST, so the rate saved is the value
 * after scheme, trade and cash discounts over the paid packs; GST on the counter is then worked out on that value.
 * Free packs are part of the same supply: no GST, and they lower the landed cost.
 */
export function ebillLineCost(l: EbillCostInput, gstRate: number, rules: PricingRules = DEFAULT_RULES) {
  const free = l.free || schemeFree(l.qty, l.scheme);
  const p = priceLine({ qty: l.qty, freeQty: free, rate: l.ptr ?? 0, gstRate, schemePct: l.schemePct, tradePct: l.discPct, cashPct: l.cdPct }, rules);
  const ratePaise = l.qty > 0 ? Math.round(p.net / l.qty) : 0;
  const taxable = ratePaise * l.qty, gst = Math.round((taxable * gstRate) / 100);
  return {
    free, ratePaise, gross: p.gross, discount: p.disc, taxable, gst, total: taxable + gst,
    /** GST the bill shows under the rules, less what the counter books (non-zero only when GST isn't on the net value). */
    gstDiff: p.gst - gst,
    landed: p.landed,
    margin: l.mrp ? marginPct(exGst(l.mrp, gstRate), p.landed) : null,
  };
}

// ---------- supplier terms (returns and the e-bill mapping) ----------

export type SupplierTerms = { supplierId: string; acceptsReturns: boolean; returnWindowDays: number; ebillMapping: EbillMapping | null };
type TermsRow = { id: string; acceptsReturns: number; returnWindowDays: number; ebillMapping: string | null };

const termsOf = (supplierId: string, r: TermsRow | null | undefined): SupplierTerms => {
  let mapping: EbillMapping | null = null;
  try { mapping = r?.ebillMapping ? (JSON.parse(r.ebillMapping) as EbillMapping) : null; } catch { mapping = null; }
  return { supplierId, acceptsReturns: r ? !!n(r.acceptsReturns) : true, returnWindowDays: r ? n(r.returnWindowDays) : 90, ebillMapping: mapping };
};
export const supplierTerms = (db: DriveDB, supplierId: string) => termsOf(supplierId, db.from<TermsRow>("supplierTerms").eq("id", supplierId).first());

/** Every supplier with its return terms (new suppliers: returns accepted up to 90 days before expiry, as on the web). */
export function supplierTermsList(db: DriveDB) {
  return db.engine.all<TermsRow & { supplierId: string; name: string; hasTerms: number }>(
    `SELECT s.id AS supplierId, s.name, t.id, t.acceptsReturns, t.returnWindowDays, t.ebillMapping, t.id IS NOT NULL AS hasTerms
       FROM supplier s LEFT JOIN supplierTerms t ON t.id = s.id AND t.deletedAt IS NULL WHERE s.deletedAt IS NULL ORDER BY s.name COLLATE NOCASE`)
    .map((r) => ({ name: r.name, ...termsOf(r.supplierId, n(r.hasTerms) ? r : null) }));
}

export const termsInput = z.object({ supplierId: id, acceptsReturns: z.boolean(), returnWindowDays: z.number().int().min(0, "Enter the days.").max(365, "Use at most 365 days.") });

export function saveSupplierTerms(db: DriveDB, input: z.input<typeof termsInput>) {
  const t = termsInput.parse(input);
  if (!db.from("supplier").eq("id", t.supplierId).count()) throw new CounterError("Supplier not found.");
  db.from("supplierTerms").upsert({ id: t.supplierId, acceptsReturns: t.acceptsReturns, returnWindowDays: t.returnWindowDays });
  return supplierTerms(db, t.supplierId);
}

// ---------- supplier e-bills ----------

export const EBILL_MAX_BYTES = 2 * 1024 * 1024;
export type MatchedBy = "barcode" | "code" | "learned" | "name";
export type EbillPreviewLine = EbillLine & {
  medicineId: string | null; matchedBy: MatchedBy | null; confidence: number;
  medicine: { id: string; name: string; gstRate: number; mrpPaise: number; packSize: number } | null;
  /** Last rate per pack paid to this supplier for the matched medicine. */
  lastRate: number | null;
};
export type EbillPreview =
  | { needsMapping: true; fingerprint: string; preview: string[][]; mapping: EbillMapping; missing: string[] }
  | {
    needsMapping: false; fingerprint: string; preview: string[][]; mapping: EbillMapping; invoiceNo: string; invoiceDate: string; skipped: number;
    lines: EbillPreviewLine[];
    /** This exact file was entered before. */
    already: { billNo: string; at: string } | null;
  };

async function fingerprintOf(bytes: Uint8Array) {
  const h = new Uint8Array(await globalThis.crypto.subtle.digest("SHA-256", bytes.slice().buffer));
  return Array.from(h, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** A mapping typed by the user, cleaned to columns that exist in the file. */
function cleanMapping(raw: EbillMapping, width: number): EbillMapping {
  const cols: Partial<Record<EbillField, number>> = {};
  for (const f of Object.keys(EBILL_FIELDS) as EbillField[]) {
    const v = raw?.cols?.[f];
    if (Number.isInteger(v) && v! >= 0 && v! < width) cols[f] = v;
  }
  const headerRow = Number.isInteger(raw?.headerRow) && raw.headerRow >= -1 && raw.headerRow < 50 ? raw.headerRow : -1;
  const rf = raw?.rowFilter;
  const rowFilter = rf && Number.isInteger(rf.col) && typeof rf.value === "string" && rf.value.trim() ? { col: rf.col, value: rf.value.trim().slice(0, 10) } : null;
  return { headerRow, cols, rowFilter };
}

/** Learned supplier codes and bill names → medicine (the latest row for a code wins). */
const itemMapOf = (db: DriveDB, supplierId: string) =>
  new Map(db.engine.all<{ code: string; medicineId: string }>("SELECT code, medicineId FROM supplierItemMap WHERE supplierId = ? ORDER BY at, id", [supplierId]).map((r) => [r.code, r.medicineId]));

export const ebillPreviewInput = z.object({
  supplierId: id, fileName: z.string().min(1).max(200), bytes: z.custom<Uint8Array>((v) => v instanceof Uint8Array, "Choose the bill file."),
  mapping: z.custom<EbillMapping>().optional(), remember: z.boolean().default(false),
});

/**
 * Reads a distributor's bill file. Columns come from the mapping passed in, else the supplier's saved mapping, else
 * header detection. Lines are matched by barcode, then the supplier's item code, then bill names matched before,
 * then name + pack (+ HSN) similarity, which the user must confirm.
 */
export async function ebillPreview(db: DriveDB, input: z.input<typeof ebillPreviewInput>): Promise<EbillPreview> {
  const i = ebillPreviewInput.parse(input);
  if (i.bytes.length > EBILL_MAX_BYTES) throw new CounterError("Bill file is larger than 2 MB.");
  if (!db.from("supplier").eq("id", i.supplierId).count()) throw new CounterError("Choose the supplier first.");
  let t: string[][];
  try { t = readEbillTable(i.fileName, i.bytes); } catch (e) { throw new CounterError(e instanceof Error ? e.message : "Couldn’t read the file."); }
  if (!t.length) throw new CounterError("The file is empty.");
  const fingerprint = await fingerprintOf(i.bytes);
  const width = Math.max(...t.slice(0, 50).map((r) => r.length));
  const preview = t.slice(0, 12).map((r) => r.slice(0, 40).map((c) => c.slice(0, 60)));
  const terms = supplierTerms(db, i.supplierId);
  const given = i.mapping ? cleanMapping(i.mapping, width) : null;
  if (given && given.headerRow >= 0) given.names = Object.fromEntries(Object.entries(given.cols).map(([f, c]) => [f, t[given.headerRow]?.[c!] ?? ""]).filter(([, nm]) => nm));
  const m = given ?? (terms.ebillMapping ? resolveMapping(t, terms.ebillMapping) : autoMapping(t));
  if (!m || missingFields(m).length) {
    return { needsMapping: true, fingerprint, preview, mapping: m ?? { headerRow: -1, cols: {}, rowFilter: null }, missing: (m ? missingFields(m) : REQUIRED_FIELDS).map((f) => EBILL_FIELDS[f]) };
  }
  const draft = applyMapping(t, m);
  if (!draft.lines.length) throw new CounterError("No item lines found with this column mapping. Check the columns and the row filter.");

  const meds = db.engine.all<Pick<Medicine, "id" | "name" | "strength" | "packSize" | "barcode" | "hsn" | "gstRate" | "mrpPaise">>(
    "SELECT id, name, strength, packSize, barcode, hsn, gstRate, mrpPaise FROM medicine WHERE deletedAt IS NULL AND active = 1");
  const byId = new Map(meds.map((x) => [x.id, x]));
  const learned = itemMapOf(db, i.supplierId);
  const lastRates = new Map(db.engine.all<{ medicineId: string; costPaise: number }>(
    `SELECT i.medicineId, i.costPaise FROM purchaseItem i JOIN purchase p ON p.id = i.purchaseId WHERE p.supplierId = ? ORDER BY p.billDate, p.at`, [i.supplierId]).map((r) => [r.medicineId, n(r.costPaise)]));
  const lines: EbillPreviewLine[] = draft.lines.map((l) => {
    let medicineId: string | null = null, matchedBy: MatchedBy | null = null, confidence = 0;
    const bc = l.barcode ? meds.find((x) => x.barcode === l.barcode) : undefined;
    const viaCode = l.code ? learned.get(l.code) : undefined, viaName = learned.get(nameKey(l.name, l.pack));
    if (bc) { medicineId = bc.id; matchedBy = "barcode"; confidence = 1; }
    else if (viaCode && byId.has(viaCode)) { medicineId = viaCode; matchedBy = "code"; confidence = 1; }
    else if (viaName && byId.has(viaName)) { medicineId = viaName; matchedBy = "learned"; confidence = 1; }
    else {
      const hsn = l.hsn.replace(/\D/g, "").slice(0, 4);
      const best = meds.map((x) => ({ x, s: nameScore(l.name, l.pack, `${x.name} ${x.strength}`, String(x.packSize)) + (hsn.length === 4 && x.hsn.startsWith(hsn) ? 0.05 : 0) }))
        .sort((a, b) => b.s - a.s)[0];
      if (best && best.s >= 0.5) { medicineId = best.x.id; matchedBy = "name"; confidence = Math.min(0.79, Math.round(best.s * 100) / 100); }
    }
    const med = medicineId ? byId.get(medicineId) : undefined;
    const problems = [...l.problems];
    if (med && l.gst != null && l.gst !== med.gstRate) problems.push(`Bill GST ${l.gst}% differs from catalogue ${med.gstRate}%`);
    if (med && l.mrp != null && l.mrp !== med.mrpPaise) problems.push("MRP differs from catalogue (new MRP batch?)");
    const medicine = med ? { id: med.id, name: `${med.name}${med.strength ? " " + med.strength : ""}`, gstRate: med.gstRate, mrpPaise: med.mrpPaise, packSize: med.packSize } : null;
    return { ...l, problems, medicineId, matchedBy, confidence, medicine, lastRate: medicineId ? lastRates.get(medicineId) ?? null : null };
  });
  if (given && i.remember) db.from("supplierTerms").upsert({ id: i.supplierId, ebillMapping: JSON.stringify(given) });
  const prior = db.engine.all<{ billNo: string; at: string }>(
    "SELECT p.billNo, e.at FROM ebillImport e JOIN purchase p ON p.id = e.purchaseId WHERE e.supplierId = ? AND e.fingerprint = ? ORDER BY e.at LIMIT 1", [i.supplierId, fingerprint])[0];
  return { needsMapping: false, fingerprint, preview, mapping: m, invoiceNo: draft.invoiceNo, invoiceDate: draft.invoiceDate, skipped: draft.skipped, lines, already: prior ?? null };
}

const yyyymm = /^\d{4}-\d{2}(-\d{2})?$/;
/** "2028-11" → last day of that month (the date printed on the strip is the month). */
const endOfMonth = (e: string) => (e.length === 10 ? e : new Date(Date.UTC(+e.slice(0, 4), +e.slice(5, 7), 0)).toISOString().slice(0, 10));

export const ebillSaveInput = z.object({
  branchId: id, supplierId: id, userId: id, fingerprint: z.string().regex(/^[0-9a-f]{64}$/), fileName: z.string().max(200).default(""),
  billNo: z.string().trim().min(1, "Enter the supplier’s bill number.").max(40),
  billDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-01."),
  lines: z.array(z.object({
    medicineId: z.string().min(1, "Pick or add a medicine for every line."),
    batch: z.string().trim().min(1, "Enter the batch number.").max(40),
    expiry: z.string().regex(yyyymm, "Enter the expiry month."),
    qty: z.number().int().min(1).max(100_000), free: z.number().int().min(0).max(100_000).default(0), scheme: z.string().max(20).default(""),
    ptr: z.number().int().min(1, "Rate missing."), mrp: z.number().int().min(0).nullable().default(null),
    schemePct: pct, discPct: pct, cdPct: pct,
    code: z.string().max(60).default(""), name: z.string().max(200).default(""), pack: z.string().max(60).default(""),
  })).min(1, "Add at least one item.").max(300),
});

/**
 * Saves a read e-bill as a counter purchase. The same file can't be entered twice for a supplier, and the same bill
 * number is refused by recordPurchase. Matches the user confirmed are remembered for this supplier's next bill.
 */
export function ebillSave(db: DriveDB, input: z.input<typeof ebillSaveInput>, today = todayISO()) {
  const e = ebillSaveInput.parse(input);
  return db.transaction(() => {
    const prior = db.engine.all<{ billNo: string }>("SELECT p.billNo FROM ebillImport e JOIN purchase p ON p.id = e.purchaseId WHERE e.supplierId = ? AND e.fingerprint = ? LIMIT 1", [e.supplierId, e.fingerprint])[0];
    if (prior) throw new CounterError(`This bill file is already entered as bill ${prior.billNo}.`);
    const rules = pricingRules(db);
    const lines = e.lines.map((l) => {
      const m = db.from<Medicine>("medicine").eq("id", l.medicineId).first();
      if (!m) throw new CounterError("A medicine on the bill isn’t in the catalogue.");
      const c = ebillLineCost(l, m.gstRate, rules);
      if (c.ratePaise < 1) throw new CounterError(`${m.name}: the rate after discounts is zero. Check the line.`);
      return { medicineId: m.id, batchNo: l.batch.toUpperCase(), expiryDate: endOfMonth(l.expiry), packs: l.qty, freePacks: c.free, costPaise: c.ratePaise, mrpPaise: l.mrp || m.mrpPaise };
    });
    const r = recordPurchase(db, { branchId: e.branchId, supplierId: e.supplierId, billNo: e.billNo, billDate: e.billDate, userId: e.userId, lines }, today);
    const at = now();
    db.from("ebillImport").insert({ supplierId: e.supplierId, purchaseId: r.purchaseId, fingerprint: e.fingerprint, fileName: e.fileName.slice(0, 200), invoiceNo: e.billNo, lines: lines.length, userId: e.userId, at });
    const known = itemMapOf(db, e.supplierId), learn: Record<string, string | number>[] = [];
    for (const l of e.lines) {
      for (const code of [l.code.trim(), l.name ? nameKey(l.name, l.pack) : ""]) {
        if (code && known.get(code) !== l.medicineId) { known.set(code, l.medicineId); learn.push({ supplierId: e.supplierId, code: code.slice(0, 120), medicineId: l.medicineId, userId: e.userId, at }); }
      }
    }
    if (learn.length) db.from("supplierItemMap").insert(learn);
    return { ...r, billNo: e.billNo, lines: lines.length };
  });
}

/** E-bills entered on the counters, newest first. */
export const ebillHistory = (db: DriveDB, limit = 30) =>
  db.engine.all<{ id: string; supplier: string; billNo: string; fileName: string; lines: number; totalPaise: number; at: string }>(
    `SELECT e.id, s.name AS supplier, p.billNo, e.fileName, e.lines, p.totalPaise, e.at FROM ebillImport e JOIN purchase p ON p.id = e.purchaseId JOIN supplier s ON s.id = e.supplierId
      ORDER BY e.at DESC LIMIT ?`, [Math.max(1, Math.min(200, limit))]).map((r) => ({ ...r, lines: n(r.lines), totalPaise: n(r.totalPaise) }));

// ---------- margins and purchase rates ----------

type RateRow = { medicineId: string; name: string; strength: string; mrpPaise: number; gstRate: number; costPaise: number; packs: number; freePacks: number; billDate: string; supplier: string; rn: number };

/**
 * Margin on today's MRP for every medicine bought on a counter, from its latest purchase: landed cost per pack (free
 * packs spread in, GST added when it can't be claimed) against MRP without GST. Also the change from the rate before.
 */
export function marginReport(db: DriveDB, opts: { text?: string; lowOnly?: boolean; limit?: number } = {}) {
  const rules = pricingRules(db);
  const q = (opts.text ?? "").trim().replace(/[\\%_]/g, (c) => `\\${c}`);
  const rows = db.engine.all<RateRow>(
    `SELECT * FROM (
       SELECT i.medicineId, m.name, m.strength, m.mrpPaise, m.gstRate, i.costPaise, i.packs, i.freePacks, p.billDate, s.name AS supplier,
              ROW_NUMBER() OVER (PARTITION BY i.medicineId ORDER BY p.billDate DESC, p.at DESC, i.id) AS rn
         FROM purchaseItem i JOIN purchase p ON p.id = i.purchaseId JOIN supplier s ON s.id = p.supplierId JOIN medicine m ON m.id = i.medicineId
        WHERE m.deletedAt IS NULL AND (?1 = '' OR m.name LIKE '%' || ?1 || '%' ESCAPE '\\'))
      WHERE rn <= 2 ORDER BY name COLLATE NOCASE, rn`, [q]);
  const out: { medicineId: string; name: string; supplier: string; billDate: string; ratePaise: number; landedPaise: number; mrpPaise: number; sellExGstPaise: number; margin: number | null; low: boolean; changePaise: number | null }[] = [];
  for (let k = 0; k < rows.length; k++) {
    const r = rows[k];
    if (n(r.rn) !== 1) continue;
    const prev = rows[k + 1]?.medicineId === r.medicineId ? rows[k + 1] : null;
    const units = n(r.packs) + n(r.freePacks), cost = n(r.costPaise) * n(r.packs);
    const landed = units ? Math.round((cost + (rules.itc ? 0 : Math.round((cost * n(r.gstRate)) / 100))) / units) : 0;
    const sell = exGst(n(r.mrpPaise), n(r.gstRate)), margin = marginPct(sell, landed);
    out.push({
      medicineId: r.medicineId, name: `${r.name}${r.strength ? " " + r.strength : ""}`, supplier: r.supplier, billDate: r.billDate, ratePaise: n(r.costPaise), landedPaise: landed,
      mrpPaise: n(r.mrpPaise), sellExGstPaise: sell, margin, low: margin != null && margin < rules.minMarginPct, changePaise: prev ? n(r.costPaise) - n(prev.costPaise) : null,
    });
  }
  const list = opts.lowOnly ? out.filter((x) => x.low || (x.margin != null && x.margin < 0)) : out;
  return { rules, rows: list.sort((a, b) => (a.margin ?? 999) - (b.margin ?? 999)).slice(0, Math.max(1, Math.min(1000, opts.limit ?? 300))) };
}

/** Every purchase rate of one medicine (newest first) and each supplier's latest and best effective rate. */
export function priceHistory(db: DriveDB, medicineId: string, limit = 50) {
  const rows = db.engine.all<{ supplierId: string; supplier: string; billNo: string; billDate: string; packs: number; freePacks: number; costPaise: number; mrpPaise: number }>(
    `SELECT p.supplierId, s.name AS supplier, p.billNo, p.billDate, i.packs, i.freePacks, i.costPaise, i.mrpPaise
       FROM purchaseItem i JOIN purchase p ON p.id = i.purchaseId JOIN supplier s ON s.id = p.supplierId
      WHERE i.medicineId = ? ORDER BY p.billDate DESC, p.at DESC LIMIT ?`, [medicineId, Math.max(1, Math.min(500, limit))])
    .map((r) => {
      const units = n(r.packs) + n(r.freePacks);
      return { ...r, packs: n(r.packs), freePacks: n(r.freePacks), costPaise: n(r.costPaise), mrpPaise: n(r.mrpPaise), effectivePaise: units ? Math.round((n(r.costPaise) * n(r.packs)) / units) : 0 };
    });
  const bySupplier = new Map<string, { supplierId: string; supplier: string; lastPaise: number; lastDate: string; bestPaise: number; bills: number }>();
  for (const r of rows) {
    const s = bySupplier.get(r.supplierId);
    if (!s) bySupplier.set(r.supplierId, { supplierId: r.supplierId, supplier: r.supplier, lastPaise: r.effectivePaise, lastDate: r.billDate, bestPaise: r.effectivePaise, bills: 1 });
    else { s.bestPaise = Math.min(s.bestPaise, r.effectivePaise); s.bills++; }
  }
  return { rows, suppliers: [...bySupplier.values()].sort((a, b) => a.lastPaise - b.lastPaise) };
}

// ---------- supplier claims ----------

/** The supplier a batch came from: set on the batch (moved from Medoro), else its latest purchase on a counter. */
function batchSupplier(db: DriveDB, batchId: string) {
  return db.engine.all<{ id: string; name: string }>(
    `SELECT s.id, s.name FROM supplier s WHERE s.id = (SELECT COALESCE(b.supplierId,
        (SELECT p.supplierId FROM purchaseItem i JOIN purchase p ON p.id = i.purchaseId WHERE i.batchId = b.id ORDER BY p.at DESC LIMIT 1)) FROM batch b WHERE b.id = ?)`, [batchId])[0] ?? null;
}
const batchStock = (db: DriveDB, batchId: string) => n(db.engine.all<{ q: number }>("SELECT COALESCE(SUM(qty), 0) AS q FROM stockMovement WHERE batchId = ?", [batchId])[0].q);

export const claimInput = z.object({
  branchId: id, batchId: id, userId: id, series: z.string().trim().min(1).max(10),
  qty: z.number().int().min(1, "Enter a quantity."),
  reason: z.enum(Object.keys(CLAIM_REASONS) as [ClaimReason, ...ClaimReason[]], { message: "Choose why the stock goes back." }),
  note: z.string().trim().max(200).default(""),
});

/**
 * Sends stock back to the supplier as a claim: the units leave stock now (a "supplier_return" movement) and the claim
 * holds their cost with GST. What the supplier is owed changes only when their credit note is recorded.
 */
export function raiseClaim(db: DriveDB, input: z.input<typeof claimInput>, today = todayISO()) {
  const i = claimInput.parse(input);
  return db.transaction(() => {
    const b = db.from<{ id: string; branchId: string; medicineId: string; batchNo: string; costPaise: number }>("batch").eq("id", i.batchId).first();
    if (!b) throw new CounterError("Batch not found.");
    if (b.branchId !== i.branchId) throw new CounterError("Claim stock from the branch that holds it.");
    const s = batchSupplier(db, b.id);
    if (!s) throw new CounterError("This batch has no supplier on record (opening stock). Write it off instead.");
    if (!supplierTerms(db, s.id).acceptsReturns && (i.reason === "expiry" || i.reason === "near_expiry")) throw new CounterError(`${s.name} doesn’t accept expiry returns.`);
    const have = batchStock(db, b.id);
    if (i.qty > have) throw new CounterError(`Only ${have} in stock.`);
    const m = db.from<Medicine>("medicine").withDeleted().eq("id", b.medicineId).first()!;
    const taxable = stockValue(n(b.costPaise), i.qty, m.packSize), tax = Math.round((taxable * m.gstRate) / 100);
    const fy = fiscalYear(today);
    const claimNo = `CLM-${i.series}-${fy}-${String(db.nextSeq(`CLM:${i.series}:${fy}`)).padStart(4, "0")}`;
    const why = `${CLAIM_REASONS[i.reason]}${i.note ? " · " + i.note : ""}`;
    const at = now();
    const c = db.from<{ id: string }>("supplierClaim").insert({
      claimNo, branchId: b.branchId, supplierId: s.id, batchId: b.id, medicineId: m.id, qty: i.qty, reason: i.reason, note: i.note || null, claimPaise: taxable + tax, taxPaise: tax, userId: i.userId, at,
    })[0];
    db.from("stockMovement").insert({ branchId: b.branchId, batchId: b.id, qty: -i.qty, type: "supplier_return", refType: "supplier_claim", refId: c.id, userId: i.userId, at, note: `${claimNo} · claim · ${why}` });
    return { claimId: c.id, claimNo, claimPaise: taxable + tax, supplier: s.name };
  });
}

type ClaimRow = { id: string; claimNo: string; supplierId: string; supplier: string; batchId: string; item: string; batchNo: string; expiry: string; qty: number; reason: ClaimReason; note: string | null; claimPaise: number; at: string };
type Ev = { claimId: string; kind: "ack" | "credit" | "close"; amountPaise: number; ref: string | null; note: string | null; at: string };
export type ClaimStatus = keyof typeof CLAIM_STATUS;

/** A claim's state from its events: credited so far, written off on closing, what is still open, and the status. */
function stateOf(claimPaise: number, evs: Ev[]) {
  const credit = evs.filter((e) => e.kind === "credit").reduce((a, e) => a + n(e.amountPaise), 0);
  const close = evs.find((e) => e.kind === "close");
  const writeOff = close ? n(close.amountPaise) : 0;
  const open = Math.max(0, claimPaise - credit - writeOff);
  const settled = !!close || open === 0;
  const status: ClaimStatus = settled ? (credit > 0 ? "credited" : "rejected") : evs.length ? "acknowledged" : "raised";
  return { credit, writeOff, writeOffReason: close?.note ?? null, open: settled ? 0 : open, status, settledAt: settled ? (close?.at ?? evs.filter((e) => e.kind === "credit").at(-1)?.at ?? null) : null };
}

const claimRows = (db: DriveDB, where = "", params: (string | number)[] = []) => db.engine.all<ClaimRow>(
  `SELECT c.id, c.claimNo, c.supplierId, s.name AS supplier, c.batchId, m.name AS item, b.batchNo, b.expiryDate AS expiry, c.qty, c.reason, c.note, c.claimPaise, c.at
     FROM supplierClaim c JOIN supplier s ON s.id = c.supplierId JOIN batch b ON b.id = c.batchId JOIN medicine m ON m.id = c.medicineId ${where} ORDER BY c.at DESC`, params);
const eventsOf = (db: DriveDB, claimIds: string[]) => {
  const map = new Map<string, Ev[]>();
  if (!claimIds.length) return map;
  for (const e of db.engine.all<Ev>(`SELECT claimId, kind, amountPaise, ref, note, at FROM claimEvent WHERE claimId IN (${claimIds.map(() => "?").join(", ")}) ORDER BY at, id`, claimIds)) {
    (map.get(e.claimId) ?? map.set(e.claimId, []).get(e.claimId)!).push(e);
  }
  return map;
};

function loadClaim(db: DriveDB, claimId: string) {
  const c = claimRows(db, "WHERE c.id = ?", [claimId])[0];
  if (!c) throw new CounterError("Claim not found.");
  return { c, st: stateOf(n(c.claimPaise), eventsOf(db, [c.id]).get(c.id) ?? []) };
}

export function acknowledgeClaim(db: DriveDB, input: { claimId: string; userId: string }) {
  return db.transaction(() => {
    const { c, st } = loadClaim(db, input.claimId);
    if (st.status !== "raised") throw new CounterError(`${c.claimNo} is already ${CLAIM_STATUS[st.status].toLowerCase()}.`);
    db.from("claimEvent").insert({ claimId: c.id, supplierId: c.supplierId, kind: "ack", amountPaise: 0, ref: null, note: null, userId: input.userId, at: now() });
    return { status: "acknowledged" as ClaimStatus };
  });
}

export const creditInput = z.object({
  claimId: id, userId: id,
  ref: z.string().trim().max(40).default(""),
  amountPaise: z.number().int().min(0, "Amount can’t be negative.").max(10_000_000_00),
  /** Write off whatever stays unpaid after this credit and close the claim. */
  close: z.boolean().default(false),
  reason: z.string().trim().max(200).default(""),
});

/**
 * Records the supplier's credit note against a claim (part credits allowed). The full credit lowers what the supplier
 * is owed; anything above the claim is a recovery. Closing writes off what is still open, with a reason; a claim
 * closed with no credit at all is rejected.
 */
export function creditClaim(db: DriveDB, input: z.input<typeof creditInput>) {
  const i = creditInput.parse(input);
  if (i.amountPaise > 0 && !i.ref) throw new CounterError("Enter the supplier’s credit note number.");
  if (!i.amountPaise && !i.close) throw new CounterError("Enter the credit amount.");
  return db.transaction(() => {
    const { c, st } = loadClaim(db, i.claimId);
    if (st.status === "credited" || st.status === "rejected") throw new CounterError(`${c.claimNo} is already closed.`);
    const at = now();
    if (i.amountPaise) db.from("claimEvent").insert({ claimId: c.id, supplierId: c.supplierId, kind: "credit", amountPaise: i.amountPaise, ref: i.ref, note: null, userId: i.userId, at });
    const left = Math.max(0, st.open - i.amountPaise);
    if (i.close && left > 0) {
      if (i.reason.length < 3) throw new CounterError("Enter why the rest of the claim is written off.");
      db.from("claimEvent").insert({ claimId: c.id, supplierId: c.supplierId, kind: "close", amountPaise: left, ref: null, note: i.reason, userId: i.userId, at });
    }
    const after = loadClaim(db, c.id).st;
    return { status: after.status, open: after.open };
  });
}

/** Open claims and those settled in the last 90 days, with their age, and what each supplier still owes on claims. */
export function listClaims(db: DriveDB, today = todayISO()) {
  const all = claimRows(db);
  const evs = eventsOf(db, all.map((c) => c.id));
  const rows = all.map((c) => {
    const st = stateOf(n(c.claimPaise), evs.get(c.id) ?? []);
    return {
      id: c.id, no: c.claimNo, supplierId: c.supplierId, supplier: c.supplier, item: `${c.item} · ${c.batchNo}`, expiry: c.expiry, qty: n(c.qty), reason: c.reason, note: c.note,
      status: st.status, claim: n(c.claimPaise), credit: st.credit, writeOff: st.writeOff, writeOffReason: st.writeOffReason, open: st.open,
      age: Math.max(0, -daysTo(c.at.slice(0, 10), today)), raisedAt: c.at, settledAt: st.settledAt,
      credits: (evs.get(c.id) ?? []).filter((e) => e.kind === "credit").map((e) => ({ ref: e.ref ?? "", amount: n(e.amountPaise), at: e.at })),
    };
  }).filter((r) => r.status === "raised" || r.status === "acknowledged" || !r.settledAt || daysTo(r.settledAt.slice(0, 10), today) >= -90);
  const bucket = (d: number) => (d <= 30 ? 0 : d <= 60 ? 1 : d <= 90 ? 2 : 3);
  const aging = new Map<string, { supplierId: string; supplier: string; count: number; open: number; buckets: [number, number, number, number] }>();
  for (const r of rows.filter((x) => x.status === "raised" || x.status === "acknowledged")) {
    const a = aging.get(r.supplierId) ?? { supplierId: r.supplierId, supplier: r.supplier, count: 0, open: 0, buckets: [0, 0, 0, 0] };
    a.count++; a.open += r.open; a.buckets[bucket(r.age)] += r.open;
    aging.set(r.supplierId, a);
  }
  return { rows, aging: [...aging.values()].sort((a, b) => b.open - a.open) };
}

type StockedBatch = { batchId: string; medicineId: string; item: string; batchNo: string; expiry: string; qty: number; costPaise: number; packSize: number; supplierId: string | null; supplier: string | null };
const stockedBatches = (db: DriveDB, branchId: string, where: string, params: (string | number)[]) => db.engine.all<StockedBatch>(
  `SELECT * FROM (
     SELECT b.id AS batchId, b.medicineId, m.name AS item, b.batchNo, b.expiryDate AS expiry, b.costPaise, m.packSize,
            (SELECT COALESCE(SUM(qty), 0) FROM stockMovement WHERE batchId = b.id) AS qty,
            COALESCE(b.supplierId, (SELECT p.supplierId FROM purchaseItem i JOIN purchase p ON p.id = i.purchaseId WHERE i.batchId = b.id ORDER BY p.at DESC LIMIT 1)) AS supplierId
       FROM batch b JOIN medicine m ON m.id = b.medicineId WHERE b.branchId = ? AND b.deletedAt IS NULL ${where}) x
   LEFT JOIN (SELECT id AS sid, name AS supplier FROM supplier) s ON s.sid = x.supplierId WHERE x.qty > 0 ORDER BY x.expiry`, [branchId, ...params])
  .map((b) => ({ ...b, qty: n(b.qty), costPaise: n(b.costPaise), packSize: n(b.packSize) || 1, supplier: b.supplierId ? b.supplier : null }));

/** A medicine's batches in stock with the supplier each came from (for raising a claim by hand). */
export const claimBatches = (db: DriveDB, medicineId: string, branchId: string, today = todayISO()) =>
  stockedBatches(db, branchId, "AND b.medicineId = ?", [medicineId]).map((b) => ({ ...b, days: daysTo(b.expiry, today), valuePaise: stockValue(b.costPaise, b.qty, b.packSize) }));

/**
 * Batches worth claiming back: stock from suppliers who take returns whose expiry falls inside that supplier's return
 * window (already expired stock included), grouped by supplier, biggest value first.
 */
export function claimSuggestions(db: DriveDB, branchId: string, today = todayISO()) {
  const terms = new Map(supplierTermsList(db).map((t) => [t.supplierId, t]));
  const groups = new Map<string, { supplierId: string; supplier: string; window: number; value: number; items: { batchId: string; item: string; batchNo: string; expiry: string; days: number; qty: number; value: number }[] }>();
  for (const b of stockedBatches(db, branchId, "", [])) {
    const t = b.supplierId ? terms.get(b.supplierId) : undefined;
    if (!t || !t.acceptsReturns) continue;
    const days = daysTo(b.expiry, today);
    if (days > t.returnWindowDays) continue;
    const g = groups.get(t.supplierId) ?? groups.set(t.supplierId, { supplierId: t.supplierId, supplier: t.name, window: t.returnWindowDays, value: 0, items: [] }).get(t.supplierId)!;
    const value = stockValue(b.costPaise, b.qty, b.packSize);
    g.items.push({ batchId: b.batchId, item: b.item, batchNo: b.batchNo, expiry: b.expiry, days, qty: b.qty, value });
    g.value += value;
  }
  return [...groups.values()].sort((a, b) => b.value - a.value);
}
