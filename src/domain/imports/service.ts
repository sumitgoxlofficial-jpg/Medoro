import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { authorizeAny, can, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { writeAudit } from "@/server/audit";
import { daysTo } from "@/lib/dates";
import { FORMS, GST_RATES, SCHEDULES, endOfMonthIfMonth as endOfMonth, medicineSchema } from "@/domain/inventory/contracts";
import { supplierSchema } from "@/domain/parties/contracts";
import { customerSchema } from "@/domain/sales/contracts";
import { createMedicineIn, receiveBatchIn } from "@/domain/inventory/service";
import { saveCustomerIn, saveSupplierIn } from "@/domain/parties/service";
import { cleanNumber, headerKey, parseExpiry, readTable, yes, type Table } from "./parse";
import { parseComposition } from "@/domain/inventory/salts";

export const IMPORT_KINDS = ["medicines", "suppliers", "customers"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];
export const MAX_ROWS = 5000;

/** Template columns and the header spellings we accept for each. */
const COLS: Record<ImportKind, { key: string; label: string; required?: boolean; aliases: string[] }[]> = {
  medicines: [
    { key: "name", label: "Brand name", required: true, aliases: ["name", "brand", "brandname", "medicine", "medicinename", "product", "productname", "item", "itemname"] },
    { key: "generic", label: "Generic / salt", aliases: ["generic", "salt", "genericname", "molecule"] },
    { key: "strength", label: "Strength", aliases: ["strength", "dose", "potency"] },
    { key: "composition", label: "Composition", aliases: ["composition", "saltcomposition", "salts", "contents", "content"] },
    { key: "form", label: "Form", required: true, aliases: ["form", "dosageform", "type"] },
    { key: "manufacturer", label: "Manufacturer", required: true, aliases: ["manufacturer", "company", "mfr", "mfg", "brandowner"] },
    { key: "pack", label: "Pack", aliases: ["pack", "packsize", "packing"] },
    { key: "packSize", label: "Units per pack", aliases: ["unitsperpack", "unitsperstrip", "tabsperstrip", "conversion", "packqty"] },
    { key: "packUnit", label: "Pack unit", aliases: ["packunit", "packtype"] },
    { key: "looseUnit", label: "Loose unit", aliases: ["looseunit", "baseunit"] },
    { key: "allowLoose", label: "Sell loose (yes/no)", aliases: ["allowloose", "loose", "sellloose", "loosesale"] },
    { key: "mrp", label: "MRP", required: true, aliases: ["mrp", "mrpperpack", "price"] },
    { key: "gstRate", label: "GST %", required: true, aliases: ["gst", "gstrate", "gstpercent", "tax", "taxrate"] },
    { key: "schedule", label: "Schedule", aliases: ["schedule", "drugschedule", "sch"] },
    { key: "hsn", label: "HSN", aliases: ["hsn", "hsncode"] },
    { key: "barcode", label: "Barcode", aliases: ["barcode", "ean", "upc"] },
    { key: "reorderLevel", label: "Reorder level", aliases: ["reorderlevel", "reorder", "minstock", "minimumstock"] },
    { key: "rack", label: "Rack", aliases: ["rack", "shelf", "location", "bin"] },
    { key: "batch", label: "Batch", aliases: ["batch", "batchno", "batchnumber", "lot"] },
    { key: "expiry", label: "Expiry", aliases: ["expiry", "exp", "expirydate", "expdate"] },
    { key: "qty", label: "Opening qty", aliases: ["qty", "quantity", "stock", "openingqty", "openingstock", "closingstock"] },
    { key: "cost", label: "Cost per pack (excl. GST)", aliases: ["cost", "costperpack", "purchaserate", "rate", "ptr", "purchaseprice"] },
  ],
  suppliers: [
    { key: "name", label: "Supplier name", required: true, aliases: ["name", "supplier", "suppliername", "party", "partyname", "distributor"] },
    { key: "gstin", label: "GSTIN", aliases: ["gstin", "gst", "gstno", "gstnumber"] },
    { key: "phone", label: "Phone", aliases: ["phone", "mobile", "contact", "phoneno"] },
    { key: "creditDays", label: "Credit days", aliases: ["creditdays", "credit", "terms", "paymentterms"] },
    { key: "leadDays", label: "Lead days", aliases: ["leaddays", "leadtime", "deliverydays"] },
    { key: "opening", label: "Opening balance (you owe)", aliases: ["opening", "openingbalance", "balance", "due", "payable", "outstanding"] },
  ],
  customers: [
    { key: "name", label: "Customer name", required: true, aliases: ["name", "customer", "customername", "patient", "party"] },
    { key: "phone", label: "Mobile", aliases: ["phone", "mobile", "mobileno", "contact", "whatsapp"] },
    { key: "creditLimit", label: "Credit limit", aliases: ["creditlimit", "limit"] },
    { key: "opening", label: "Opening balance (they owe)", aliases: ["opening", "openingbalance", "balance", "due", "receivable", "outstanding"] },
    { key: "waOptIn", label: "WhatsApp opt-in (yes/no)", aliases: ["waoptin", "whatsappoptin", "optin", "consent"] },
  ],
};

export const templateHeader = (kind: ImportKind) => COLS[kind].map((c) => c.label);
export const TEMPLATE_EXAMPLE: Record<ImportKind, string[]> = {
  medicines: ["Dolo 650", "Paracetamol", "650 mg", "Paracetamol 650mg", "Tablet", "Micro Labs", "15 tabs", "15", "strip", "tab", "yes", "33.60", "12", "", "3004", "8901234567890", "20", "A1", "DL24091", "11/2027", "40", "24.50"],
  suppliers: ["Mahavir Medical Agencies", "27AABCM1234F1Z5", "9822012345", "30", "2", "0"],
  customers: ["Ramesh Kulkarni", "9890112345", "2000", "0", "yes"],
};

export type RowResult = { line: number; label: string; action: "create" | "add stock" | "skip"; note: string; errors: string[] };
export type Preview = { kind: ImportKind; columns: { label: string; found: string | null; required: boolean }[]; rows: RowResult[]; ok: number; skip: number; bad: number };

type Mapped = { line: number; v: Record<string, string> };

function mapColumns(kind: ImportKind, t: Table) {
  if (t.length < 2) throw new UserError("The file has no data rows under the header.");
  if (t.length - 1 > MAX_ROWS) throw new UserError(`Up to ${MAX_ROWS.toLocaleString("en-IN")} rows per file. Split the file and import in parts.`);
  const head = t[0].map(headerKey);
  const idx: Record<string, number> = {};
  const columns = COLS[kind].map((c) => {
    const i = head.findIndex((h) => c.aliases.includes(h) || h === headerKey(c.label));
    if (i >= 0) idx[c.key] = i;
    return { label: c.label, found: i >= 0 ? t[0][i] : null, required: !!c.required };
  });
  const has = (label: string) => columns.some((c) => c.label === label && c.found);
  // A composition column ("Paracetamol 500mg + Caffeine 25mg") can stand in for generic; strength is checked per row.
  const salt = kind === "medicines" && !has("Composition") && !has("Generic / salt") ? ["Generic / salt"] : [];
  const missing = [...columns.filter((c) => c.required && !c.found).map((c) => c.label), ...salt];
  if (missing.length) throw new UserError(`Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. Download the template to see the expected headers.`);
  const rows: Mapped[] = t.slice(1).map((r, i) => ({ line: i + 2, v: Object.fromEntries(Object.entries(idx).map(([k, j]) => [k, (r[j] ?? "").trim()])) }));
  return { columns, rows };
}

const zodErrors = (e: z.ZodError) => e.issues.map((i) => i.message);
const nameKey = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const formOf = (s: string) => FORMS.find((f) => f.toLowerCase() === s.toLowerCase().replace(/s$/, "") || f.toLowerCase() === s.toLowerCase()) ?? null;
const scheduleOf = (s: string) => { const v = s.toUpperCase().replace(/SCHEDULE|SCH\.?|\s/g, ""); return (SCHEDULES as readonly string[]).includes(v) ? v : null; };

/** Validates every row and works out what importing it would do. Nothing is written. */
async function plan(ctx: Ctx, kind: ImportKind, t: Table) {
  const { columns, rows } = mapColumns(kind, t);
  const out: (RowResult & { input?: unknown })[] = [];

  if (kind === "medicines") {
    authorizeAny(ctx, "adjust", "purchase");
    const [meds, batches] = await Promise.all([
      db.medicine.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true, strength: true, barcode: true, active: true } }),
      db.batch.findMany({ where: { tenantId: ctx.tenantId, branchId: ctx.branchId }, select: { medicineId: true, batchNo: true } }),
    ]);
    const key = (n: string, s: string) => `${n.toLowerCase()}|${s.toLowerCase()}`;
    const existing = new Map(meds.filter((m) => m.active).map((m) => [key(m.name, m.strength), m.id]));
    const barcodes = new Set(meds.map((m) => m.barcode).filter(Boolean)); // unique across inactive medicines too
    const fileBarcodes = new Map<string, { k: string; line: number }>();
    const batchSet = new Set(batches.map((b) => `${b.medicineId}|${b.batchNo}`));
    const seenMed = new Map<string, number>(), seenBatch = new Set<string>();
    for (const { line, v } of rows) {
      const errors: string[] = [];
      const form = formOf(v.form ?? "");
      if (!form) errors.push(`Form “${v.form}” isn’t one of: ${FORMS.join(", ")}.`);
      const schedule = scheduleOf(v.schedule ?? "");
      if (schedule === null) errors.push(`Schedule “${v.schedule}” should be blank, H, H1, X or G.`);
      const gst = cleanNumber(v.gstRate ?? "");
      if (!(GST_RATES as readonly number[]).includes(Number(gst))) errors.push(`GST “${v.gstRate}” should be 0, 5, 12, 18 or 28.`);
      // A salt column with strengths in it ("Paracetamol 500mg + Caffeine 25mg") is a composition.
      const composition = v.composition || (/\d/.test(v.generic ?? "") ? v.generic! : "");
      const salts = composition ? parseComposition(composition) : [];
      const generic = !v.generic || /\d/.test(v.generic) ? salts.map((x) => x.name).join(" + ") || (v.generic ?? "") : v.generic;
      const strength = v.strength || salts.map((x) => x.strength).filter(Boolean).join(" + ");
      const packSize = cleanNumber(v.packSize ?? "") || "1";
      const med = { name: v.name, generic, strength, form: form ?? "Other", manufacturer: v.manufacturer, pack: v.pack ?? "", mrp: cleanNumber(v.mrp ?? ""), gstRate: gst || "0", schedule: schedule ?? "", reorderLevel: cleanNumber(v.reorderLevel ?? "") || "10", barcode: v.barcode ?? "", hsn: v.hsn || "3004", rack: v.rack ?? "",
        composition, packSize, packUnit: v.packUnit ?? "", looseUnit: v.looseUnit ?? "", allowLoose: yes(v.allowLoose ?? "") && Number(packSize) > 1 };
      const p = medicineSchema.safeParse(med);
      if (!p.success) errors.push(...zodErrors(p.error));
      const k = key(v.name ?? "", v.strength ?? "");
      const medId = existing.get(k) ?? null;
      const firstLine = seenMed.get(k);
      if (!medId && firstLine === undefined) seenMed.set(k, line);
      if (!medId && v.barcode && barcodes.has(v.barcode)) errors.push(`Barcode ${v.barcode} is already used by another medicine.`);
      const bc = fileBarcodes.get(v.barcode ?? "");
      if (!medId && firstLine === undefined && v.barcode) {
        if (bc && bc.k !== k) errors.push(`Barcode ${v.barcode} is also on row ${bc.line} for a different medicine.`);
        else if (!bc) fileBarcodes.set(v.barcode, { k, line });
      }

      let stock: { batchNo: string; expiry: string; qty: string; cost: string; mrp: string } | null = null;
      const bk = `${medId ?? k}|${(v.batch ?? "").toUpperCase()}`;
      const stockInDb = !!v.batch && batchSet.has(bk); // imported before: skip, so re-running a file is safe
      if ((v.batch || v.qty) && !stockInDb) {
        const expiry = parseExpiry(v.expiry ?? "");
        if (!v.batch) errors.push("Opening stock needs a batch number.");
        if (!expiry) errors.push(`Expiry “${v.expiry ?? ""}” isn’t a date. Use MM/YYYY, like 11/2027.`);
        else if (daysTo(endOfMonth(expiry)) <= 0) errors.push(`Batch ${v.batch} expired (${v.expiry}). Expired stock isn’t imported as sellable.`);
        if (!/^\d+$/.test(v.qty ?? "") || Number(v.qty) < 1) errors.push(`Quantity “${v.qty ?? ""}” must be a whole number of packs.`);
        const cost = cleanNumber(v.cost ?? "");
        if (!(Number(cost) > 0)) errors.push("Opening stock needs cost per pack (excluding GST).");
        else if (Number(cost) > Number(med.mrp)) errors.push("Cost is above MRP.");
        if (v.batch && seenBatch.has(bk)) errors.push(`Batch ${v.batch} appears twice in this file for the same medicine.`);
        seenBatch.add(bk);
        stock = { batchNo: (v.batch ?? "").toUpperCase(), expiry: expiry ?? "", qty: v.qty ?? "", cost, mrp: med.mrp };
      }
      const label = `${v.name ?? ""} ${v.strength ?? ""}`.trim();
      const action = medId || firstLine !== undefined ? (stock ? "add stock" : "skip") : "create";
      if (action === "skip" && medId) errors.length = 0; // already fully on file; nothing to check
      const note = action === "create" ? (stock ? `New medicine with ${stock.qty} packs in batch ${stock.batchNo}` : "New medicine")
        : action === "add stock" ? `Already listed${firstLine ? ` (row ${firstLine})` : ""}; adds batch ${stock!.batchNo}`
        : stockInDb ? `Batch ${(v.batch ?? "").toUpperCase()} already in stock` : `Already listed${firstLine ? ` (row ${firstLine})` : ""}`;
      out.push({ line, label, action, note, errors, input: { med, stock, key: k } });
    }
  }

  if (kind === "suppliers") {
    authorizeAny(ctx, "purchase", "payments");
    const names = new Set((await db.supplier.findMany({ where: { tenantId: ctx.tenantId }, select: { name: true } })).map((s) => s.name.toLowerCase()));
    const seen = new Map<string, number>();
    for (const { line, v } of rows) {
      const input = { name: v.name, gstin: v.gstin ?? "", phone: v.phone ?? "", creditDays: cleanNumber(v.creditDays ?? "") || "30", leadDays: cleanNumber(v.leadDays ?? "") || "1", opening: cleanNumber(v.opening ?? "") || "0" };
      const p = supplierSchema.safeParse(input);
      const errors = p.success ? [] : zodErrors(p.error);
      if (p.success && p.data.opening > 0 && !can(ctx, "payments")) errors.push("Opening balances need the payments permission.");
      const k = (v.name ?? "").toLowerCase(), dupLine = seen.get(k);
      if (!seen.has(k)) seen.set(k, line);
      const exists = names.has(k) || dupLine !== undefined;
      out.push({ line, label: v.name ?? "", action: exists ? "skip" : "create", note: exists ? `Already exists${dupLine ? ` (row ${dupLine})` : ""}` : input.opening !== "0" ? `New supplier, opening ₹${input.opening}` : "New supplier", errors: exists ? [] : errors, input });
    }
  }

  if (kind === "customers") {
    authorizeAny(ctx, "sale");
    const all = await db.customer.findMany({ where: { tenantId: ctx.tenantId }, select: { phone: true, name: true, erasedAt: true } });
    const phones = new Set(all.filter((c) => c.phone).map((c) => c.phone!));
    // Customers without a mobile can only be told apart by name.
    const phoneless = new Set(all.filter((c) => !c.phone && !c.erasedAt).map((c) => nameKey(c.name)));
    const seen = new Map<string, number>();
    for (const { line, v } of rows) {
      const input = { name: v.name, phone: v.phone ?? "", creditLimit: cleanNumber(v.creditLimit ?? "") || "0", waOptIn: yes(v.waOptIn ?? ""), opening: cleanNumber(v.opening ?? "") || "0" };
      const p = customerSchema.safeParse(input);
      const errors = p.success ? [] : zodErrors(p.error);
      if (Number(input.creditLimit) > 0 && !can(ctx, "credit")) errors.push("Credit limits need the credit permission.");
      if (Number(input.opening) > 0 && !can(ctx, "payments")) errors.push("Opening balances need the payments permission.");
      if (!/^\d*(\.\d+)?$/.test(input.opening)) errors.push(`Opening balance “${v.opening}” isn’t a number.`);
      const ph = p.success ? p.data.phone : "";
      const nk = ph || "name:" + nameKey(v.name ?? "");
      const dupLine = nk !== "name:" ? seen.get(nk) : undefined;
      if (nk !== "name:" && !seen.has(nk)) seen.set(nk, line);
      const exists = ph ? phones.has(ph) || dupLine !== undefined : nk !== "name:" && (phoneless.has(nameKey(v.name ?? "")) || dupLine !== undefined);
      out.push({ line, label: v.name ?? "", action: exists ? "skip" : "create", note: exists ? `${ph ? "Mobile" : "Customer without mobile"} already on file${dupLine ? ` (row ${dupLine})` : ""}` : "New customer", errors: exists ? [] : errors, input });
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const rowsOut = out.map(({ input: _i, ...r }) => r);
  return {
    preview: { kind, columns, rows: rowsOut, ok: out.filter((r) => !r.errors.length && r.action !== "skip").length, skip: out.filter((r) => !r.errors.length && r.action === "skip").length, bad: out.filter((r) => r.errors.length).length } satisfies Preview,
    work: out,
  };
}

export async function previewImport(ctx: Ctx, kind: ImportKind, fileName: string, bytes: Uint8Array): Promise<Preview> {
  return (await plan(ctx, kind, tableOf(fileName, bytes))).preview;
}

function tableOf(fileName: string, bytes: Uint8Array) {
  try { return readTable(fileName, bytes); } catch (e) { throw new UserError(e instanceof Error ? e.message : "Couldn’t read the file."); }
}

/**
 * Re-validates the file on the server and imports it all-or-nothing in one transaction, through the same
 * services the screens use. Re-running the same file is safe: rows already imported are skipped.
 */
export async function runImport(ctx: Ctx, kind: ImportKind, fileName: string, bytes: Uint8Array) {
  const { preview, work } = await plan(ctx, kind, tableOf(fileName, bytes));
  if (preview.bad) throw new UserError(`${preview.bad} row${preview.bad > 1 ? "s have" : " has"} problems. Fix them in the file and upload it again.`);
  const { created, stocked } = await db.$transaction(async (tx) => {
    let created = 0, stocked = 0;
    const medIds = new Map<string, string>();
    for (const r of work) {
      if (r.action === "skip") continue;
      try {
        if (kind === "medicines") {
          const { med, stock, key } = r.input as { med: Parameters<typeof createMedicineIn>[2]; stock: { batchNo: string; expiry: string; qty: string; cost: string; mrp: string } | null; key: string };
          let id = medIds.get(key);
          if (!id) {
            const found = await tx.medicine.findFirst({ where: { tenantId: ctx.tenantId, active: true, name: { equals: String(med.name), mode: "insensitive" }, strength: { equals: String(med.strength), mode: "insensitive" } }, select: { id: true } });
            id = found?.id ?? (await createMedicineIn(tx, ctx, med));
            if (!found) created++;
            medIds.set(key, id);
          }
          if (stock) { await receiveBatchIn(tx, ctx, { medicineId: id, batchNo: stock.batchNo, expiry: stock.expiry, qty: stock.qty, cost: stock.cost, mrp: stock.mrp, supplierId: null, invoiceNo: "" }); stocked++; }
        } else if (kind === "suppliers") {
          await saveSupplierIn(tx, ctx, null, r.input as Parameters<typeof saveSupplierIn>[3]); created++;
        } else {
          await saveCustomerIn(tx, ctx, null, r.input as Parameters<typeof saveCustomerIn>[3]); created++;
        }
      } catch (e) {
        if (e instanceof UserError) throw new UserError(`Row ${r.line}: ${e.message} Nothing was imported.`);
        throw e;
      }
    }
    await writeAudit(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: "Data imported", entity: "import", detail: `${kind} from ${fileName.slice(0, 80)} · ${created} created${kind === "medicines" ? `, ${stocked} batches` : ""}, ${preview.skip} skipped` });
    return { created, stocked };
  }, { maxWait: 10_000, timeout: 600_000 }); // up to MAX_ROWS rows, several statements each
  return { created, stocked, skipped: preview.skip, failed: [] as string[] };
}
