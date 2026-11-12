/**
 * Importing a shop's stock list (Excel or CSV) on the counter: the same columns, checks and "plain stock sheet" defaults as the
 * online Import, run against this device's database. One row per batch. Everything is checked before anything is written, and the
 * write is all-or-nothing, so a half-imported file can't happen. Running the same file again skips batches already in stock.
 */
import { DriveDB } from "./client";
import { addMedicine, receiveStock, CounterError, type Batch, type Medicine } from "./pharmacy";
import { cleanNumber, parseExpiry, yes, type Table } from "@/domain/imports/parse";
import { SheetError, formOf, inferForm, mapColumns, scheduleOf, type Preview, type RowResult } from "@/domain/imports/columns";
import { GST_RATES, endOfMonthIfMonth } from "@/domain/inventory/contracts";
import { todayISO } from "@/lib/dates";

type Planned = RowResult & {
  med: { name: string; generic: string; strength: string; form: string; manufacturer: string; barcode: string | null; hsn: string; gstRate: 0 | 5 | 12 | 18 | 28; mrpPaise: number; schedule: string | null; packSize: number; packUnit: string; looseUnit: string; allowLoose: boolean; reorderLevel: number; rack: string | null; composition: string | null };
  key: string;
  stock: { batchNo: string; expiryDate: string; packs: number; costPaise: number; mrpPaise: number } | null;
};

const paise = (s: string) => Math.round(Number(s) * 100);

function plan(db: DriveDB, branchId: string, table: Table, today: string) {
  let mapped;
  try { mapped = mapColumns("medicines", table); } catch (e) { throw e instanceof SheetError ? new CounterError(e.message) : e; }
  const { columns, rows, stockSheet } = mapped;
  const meds = db.from<Medicine>("medicine").all();
  const batches = db.from<Batch>("batch").eq("branchId", branchId).all();
  const key = (n: string, s: string) => `${n.toLowerCase()}|${s.toLowerCase()}`;
  const byKey = new Map(meds.filter((m) => m.active).map((m) => [key(m.name, m.strength), m]));
  const barcodes = new Set(meds.map((m) => m.barcode).filter(Boolean));
  const batchSet = new Set(batches.map((b) => `${b.medicineId}|${b.batchNo.toUpperCase()}`));
  const fileBarcodes = new Map<string, { k: string; line: number }>();
  const seenMed = new Map<string, number>(), seenBatch = new Set<string>();
  const out: Planned[] = [];

  for (const { line, v } of rows) {
    const errors: string[] = [], assumed: string[] = [];
    if (stockSheet) {
      if (!v.form) { v.form = inferForm(v.name ?? ""); assumed.push(`form ${v.form}`); }
      if (!v.manufacturer) { v.manufacturer = "Not given"; assumed.push("manufacturer not given"); }
      if (!v.gstRate) { v.gstRate = "12"; assumed.push("GST 12%"); }
      if (!v.generic && !v.composition) { v.generic = (v.name ?? "").replace(/\d+[a-z%.]*/gi, " ").replace(/\s+/g, " ").trim() || (v.name ?? ""); assumed.push("salt taken from the name"); }
    }
    const name = (v.name ?? "").trim();
    if (name.length < 2) errors.push("Brand name is required.");
    const form = formOf(v.form ?? "");
    if (!form) errors.push(`Form “${v.form}” isn’t one of the listed dosage forms.`);
    const schedule = scheduleOf(v.schedule ?? "");
    if (schedule === null) errors.push(`Schedule “${v.schedule}” should be blank, H, H1, X, G or NDPS (narcotic).`);
    const gst = Number(cleanNumber(v.gstRate ?? ""));
    if (!(GST_RATES as readonly number[]).includes(gst)) errors.push(`GST “${v.gstRate}” should be 0, 5, 12, 18 or 28.`);
    const mrp = cleanNumber(v.mrp ?? "");
    if (!(Number(mrp) > 0)) errors.push("Enter a valid MRP.");
    const packSize = Math.floor(Number(cleanNumber(v.packSize ?? "") || "1"));
    if (!(packSize >= 1 && packSize <= 1000)) errors.push("Units per pack must be between 1 and 1000.");
    const strength = v.strength ?? "";
    const k = key(name, strength);
    const found = byKey.get(k) ?? null;
    const firstLine = seenMed.get(k);
    if (!found && firstLine === undefined) seenMed.set(k, line);
    if (!found && v.barcode && barcodes.has(v.barcode)) errors.push(`Barcode ${v.barcode} is already used by another medicine.`);
    if (!found && firstLine === undefined && v.barcode) {
      const bc = fileBarcodes.get(v.barcode);
      if (bc && bc.k !== k) errors.push(`Barcode ${v.barcode} is also on row ${bc.line} for a different medicine.`);
      else if (!bc) fileBarcodes.set(v.barcode, { k, line });
    }
    const med: Planned["med"] = {
      name, generic: v.generic || v.composition || name, strength, form: form ?? "Other", manufacturer: v.manufacturer || "Not given", barcode: v.barcode || null, hsn: v.hsn || "3004",
      gstRate: gst as 12, mrpPaise: paise(mrp || "0"), schedule: schedule || null, packSize: packSize || 1, packUnit: v.packUnit || "pack", looseUnit: v.looseUnit || "unit",
      allowLoose: yes(v.allowLoose ?? "") && packSize > 1, reorderLevel: Math.floor(Number(cleanNumber(v.reorderLevel ?? "") || "10")) || 0, rack: v.rack || null, composition: v.composition || null,
    };

    let stock: Planned["stock"] = null;
    const bk = `${found?.id ?? k}|${(v.batch ?? "").toUpperCase()}`;
    const inStock = !!v.batch && !!found && batchSet.has(bk);
    if ((v.batch || v.qty) && !inStock) {
      const e = parseExpiry(v.expiry ?? "");
      const expiryDate = e ? endOfMonthIfMonth(e) : "";
      if (!v.batch) errors.push("Opening stock needs a batch number.");
      if (!e) errors.push(`Expiry “${v.expiry ?? ""}” isn’t a date. Use MM/YYYY, like 11/2027.`);
      else if (expiryDate <= today) errors.push(`Batch ${v.batch} expired (${v.expiry}). Expired stock isn’t imported as sellable.`);
      if (!/^\d+$/.test(v.qty ?? "") || Number(v.qty) < 1) errors.push(`Quantity “${v.qty ?? ""}” must be a whole number of packs.`);
      const cost = cleanNumber(v.cost ?? "");
      if (!(Number(cost) > 0)) errors.push("Opening stock needs cost per pack (excluding GST).");
      else if (Number(cost) > Number(mrp)) errors.push("Cost is above MRP.");
      if (v.batch && seenBatch.has(bk)) errors.push(`Batch ${v.batch} appears twice in this file for the same medicine.`);
      seenBatch.add(bk);
      stock = { batchNo: (v.batch ?? "").toUpperCase(), expiryDate, packs: Number(v.qty) || 0, costPaise: paise(cost || "0"), mrpPaise: med.mrpPaise };
    }
    const label = `${name} ${strength}`.trim();
    const action: RowResult["action"] = found || firstLine !== undefined ? (stock ? "add stock" : "skip") : "create";
    if (action === "skip" && found) errors.length = 0;
    const note = action === "create" ? (stock ? `New medicine with ${stock.packs} packs in batch ${stock.batchNo}` : "New medicine")
      : action === "add stock" ? `Already listed${firstLine ? ` (row ${firstLine})` : ""}; adds batch ${stock!.batchNo}`
      : inStock ? `Batch ${(v.batch ?? "").toUpperCase()} already in stock` : `Already listed${firstLine ? ` (row ${firstLine})` : ""}`;
    const check = assumed.length && action === "create" ? ` · assumed ${assumed.join(", ")}: check them in Stock` : "";
    out.push({ line, label, action, note: note + check, errors, med, key: k, stock });
  }
  const preview: Preview = {
    kind: "medicines", columns, rows: out.map(({ line, label, action, note, errors }) => ({ line, label, action, note, errors })),
    ok: out.filter((r) => !r.errors.length && r.action !== "skip").length, skip: out.filter((r) => !r.errors.length && r.action === "skip").length, bad: out.filter((r) => r.errors.length).length,
  };
  return { preview, work: out, found: byKey };
}

export function previewStockSheet(db: DriveDB, branchId: string, table: Table, today = todayISO()): Preview {
  return plan(db, branchId, table, today).preview;
}

/** Writes the file in one transaction. Returns how many medicines were created and how many batches were added. */
export function importStockSheet(db: DriveDB, input: { branchId: string; userId: string; table: Table }, today = todayISO()) {
  const { preview, work, found } = plan(db, input.branchId, input.table, today);
  if (preview.bad) throw new CounterError(`${preview.bad} row${preview.bad > 1 ? "s have" : " has"} problems. Fix them in the file and upload it again.`);
  return db.transaction(() => {
    let created = 0, stocked = 0;
    const ids = new Map<string, { id: string; packSize: number }>();
    for (const r of work) {
      if (r.action === "skip") continue;
      let m = ids.get(r.key);
      if (!m) {
        const f = found.get(r.key);
        if (f) m = { id: f.id, packSize: f.packSize };
        else { const c = addMedicine(db, r.med); m = { id: c.id, packSize: c.packSize }; created++; }
        ids.set(r.key, m);
      }
      if (r.stock) {
        receiveStock(db, { branchId: input.branchId, medicineId: m.id, batchNo: r.stock.batchNo, expiryDate: r.stock.expiryDate, qty: r.stock.packs * m.packSize, costPaise: r.stock.costPaise, mrpPaise: r.stock.mrpPaise, type: "opening", userId: input.userId });
        stocked++;
      }
    }
    return { created, stocked, skipped: preview.skip };
  });
}
