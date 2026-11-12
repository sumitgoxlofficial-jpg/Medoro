import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { authorizeAny, can, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { writeAudit } from "@/server/audit";
import { daysTo } from "@/lib/dates";
import { FORMS, GST_RATES, endOfMonthIfMonth as endOfMonth, medicineSchema } from "@/domain/inventory/contracts";
import { supplierSchema } from "@/domain/parties/contracts";
import { customerSchema } from "@/domain/sales/contracts";
import { createMedicineIn, receiveBatchIn } from "@/domain/inventory/service";
import { saveCustomerIn, saveSupplierIn } from "@/domain/parties/service";
import { cleanNumber, parseExpiry, readTable, yes, type Table } from "./parse";
import { parseComposition } from "@/domain/inventory/salts";

import { MAX_ROWS as _MAX, IMPORT_KINDS, SheetError, TEMPLATE_EXAMPLE, formOf, inferForm, type Preview, type RowResult, mapColumns as mapColumnsPure, scheduleOf, templateHeader, type ImportKind } from "./columns";
export { IMPORT_KINDS, TEMPLATE_EXAMPLE, inferForm, templateHeader, type ImportKind };
export const MAX_ROWS = _MAX;

/** The file's own problems surface as the same user-facing error the screens already show. */
function mapColumns(kind: ImportKind, t: Table) {
  try { return mapColumnsPure(kind, t); } catch (e) { throw e instanceof SheetError ? new UserError(e.message) : e; }
}

export type { RowResult, Preview };
const zodErrors = (e: z.ZodError) => e.issues.map((i) => i.message);
const nameKey = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
/** Validates every row and works out what importing it would do. Nothing is written. */
async function plan(ctx: Ctx, kind: ImportKind, t: Table) {
  const { columns, rows, stockSheet } = mapColumns(kind, t);
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
      const errors: string[] = [], assumed: string[] = [];
      if (stockSheet) {
        if (!v.form) { v.form = inferForm(v.name ?? ""); assumed.push(`form ${v.form}`); }
        if (!v.manufacturer) { v.manufacturer = "Not given"; assumed.push("manufacturer not given"); }
        if (!v.gstRate) { v.gstRate = "12"; assumed.push("GST 12%"); }
        if (!v.generic && !v.composition) { v.generic = (v.name ?? "").replace(/\d+[a-z%.]*/gi, " ").replace(/\s+/g, " ").trim() || (v.name ?? ""); assumed.push("salt taken from the name"); }
        if (!v.strength) v.strength = "-";
      }
      const form = formOf(v.form ?? "");
      if (!form) errors.push(`Form “${v.form}” isn’t one of: ${FORMS.join(", ")}.`);
      const schedule = scheduleOf(v.schedule ?? "");
      if (schedule === null) errors.push(`Schedule “${v.schedule}” should be blank, H, H1, X, G or NDPS (narcotic).`);
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
      const check = assumed.length && action === "create" ? ` · assumed ${assumed.join(", ")}: check them in Inventory` : "";
      out.push({ line, label, action, note: note + check, errors, input: { med, stock, key: k } });
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
      const input = { name: v.name, phone: v.phone ?? "", creditLimit: cleanNumber(v.creditLimit ?? "") || "0", waOptIn: yes(v.waOptIn ?? ""), opening: cleanNumber(v.opening ?? "") || "0", consentMethod: "import" as const, gstin: v.gstin ?? "" };
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
          await saveCustomerIn(tx, ctx, null, r.input as Parameters<typeof saveCustomerIn>[3], "import"); created++;
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
