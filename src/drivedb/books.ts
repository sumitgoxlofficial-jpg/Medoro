/**
 * Accounts, reports and GST on the device database (DriveDB phase 5).
 *   - Suppliers: what each is owed (bills − payments), paying them, their ledger.
 *   - Expenses and the day's cash book.
 *   - Reports: sales by day with profit, top medicines, expiring stock, reorder list.
 *   - GST: GSTR-1 (JSON + CSV), GSTR-3B and the HSN summary, built with the same builders as the server
 *     (src/domain/gst), so the device produces exactly the same returns.
 */
import { z } from "zod";
import { DriveDB } from "./client";
import { CounterError } from "./pharmacy";
import { addDays, istDate, istMidnight, todayISO } from "@/lib/dates";
import { stateOf } from "@/domain/accounting/gst";
import { allocateHalves } from "@/domain/gst/tax";
import { fpOf, hsnCsv, hsnRows, uqcFor, type GstDoc, type GstLine } from "@/domain/gst/common";
import { buildGstr1, gstr1Csv, gstr1Summary } from "@/domain/gst/gstr1";
import { buildGstr3b, gstr3bRows } from "@/domain/gst/gstr3b";

const n = (v: unknown) => Number(v ?? 0);
const range = (fromIso: string, toIso: string) => [istMidnight(fromIso).toISOString(), istMidnight(addDays(toIso, 1)).toISOString()] as const;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const money = z.number().int().min(100, "Enter at least ₹1.").max(10_000_000_00);
const modes = z.enum(["cash", "upi", "bank", "cheque"]);

// ---------- suppliers ----------

/** What each supplier is owed: purchase bills less payments. */
export function supplierDues(db: DriveDB) {
  return db.engine.all<{ id: string; name: string; gstin: string | null; billed: number; paid: number }>(
    `SELECT s.id, s.name, s.gstin,
            (SELECT COALESCE(SUM(totalPaise), 0) FROM purchase p WHERE p.supplierId = s.id) AS billed,
            (SELECT COALESCE(SUM(amountPaise), 0) FROM supplierPayment x WHERE x.supplierId = s.id) AS paid
       FROM supplier s WHERE s.deletedAt IS NULL ORDER BY s.name COLLATE NOCASE`)
    .map((r) => ({ ...r, billed: n(r.billed), paid: n(r.paid), duePaise: n(r.billed) - n(r.paid) }));
}

export const supplierPaymentInput = z.object({ supplierId: z.string().min(1), amountPaise: money, mode: modes, ref: z.string().trim().max(60).optional(), userId: z.string().min(1) });

/** Records a payment to a supplier. Refuses more than is owed. */
export function paySupplier(db: DriveDB, input: z.input<typeof supplierPaymentInput>) {
  const p = supplierPaymentInput.parse(input);
  return db.transaction(() => {
    const due = supplierDues(db).find((s) => s.id === p.supplierId);
    if (!due) throw new CounterError("Supplier not found.");
    if (p.amountPaise > due.duePaise) throw new CounterError(`${due.name} is owed only ₹${(due.duePaise / 100).toFixed(2)}.`);
    db.from("supplierPayment").insert({ supplierId: p.supplierId, amountPaise: p.amountPaise, mode: p.mode, ref: p.ref ?? null, userId: p.userId, at: new Date().toISOString() });
    return { duePaise: due.duePaise - p.amountPaise };
  });
}

/** A supplier's bills and payments, oldest first, with the running balance. */
export function supplierLedger(db: DriveDB, supplierId: string) {
  const rows = db.engine.all<{ at: string; kind: string; ref: string; amount: number }>(
    `SELECT at, 'bill' AS kind, billNo AS ref, totalPaise AS amount FROM purchase WHERE supplierId = ?1
     UNION ALL SELECT at, 'payment' AS kind, COALESCE(ref, mode) AS ref, -amountPaise AS amount FROM supplierPayment WHERE supplierId = ?1
     ORDER BY at`, [supplierId]);
  let bal = 0;
  return rows.map((r) => { bal += n(r.amount); return { ...r, amount: n(r.amount), balancePaise: bal }; });
}

// ---------- expenses and cash book ----------

export const EXPENSE_CATEGORIES = ["Rent", "Salaries", "Electricity", "Internet & phone", "Transport", "Repairs", "Stationery", "Bank charges", "Other"] as const;
export const expenseInput = z.object({
  branchId: z.string().min(1), category: z.enum(EXPENSE_CATEGORIES), amountPaise: money, mode: modes,
  note: z.string().trim().max(200).optional(), userId: z.string().min(1), date: isoDate.optional(),
});

export function addExpense(db: DriveDB, input: z.input<typeof expenseInput>) {
  const e = expenseInput.parse(input);
  if (e.date && e.date > todayISO()) throw new CounterError("The date can’t be in the future.");
  const at = e.date && e.date !== todayISO() ? new Date(istMidnight(e.date).getTime() + 12 * 3600_000).toISOString() : new Date().toISOString();
  return db.from<{ id: string }>("expense").insert({ branchId: e.branchId, category: e.category, amountPaise: e.amountPaise, mode: e.mode, note: e.note ?? null, userId: e.userId, at })[0];
}

export function expenses(db: DriveDB, branchId: string, fromIso: string, toIso: string) {
  const [from, to] = range(fromIso, toIso);
  return db.engine.all<{ id: string; category: string; amountPaise: number; mode: string; note: string | null; at: string }>(
    "SELECT id, category, amountPaise, mode, note, at FROM expense WHERE branchId = ? AND at >= ? AND at < ? ORDER BY at DESC", [branchId, from, to]);
}

/** Every cash movement of one day, in time order, with the total. */
export function cashBook(db: DriveDB, branchId: string, iso = todayISO()) {
  const [from, to] = range(iso, iso);
  const rows = db.engine.all<{ at: string; what: string; amount: number }>(
    `SELECT s.at, 'Bill ' || s.invoiceNo AS what, p.amountPaise AS amount FROM payment p JOIN sale s ON s.id = p.saleId WHERE p.mode = 'cash' AND s.branchId = ?1 AND s.at >= ?2 AND s.at < ?3
     UNION ALL SELECT r.at, 'Received from ' || c.name, r.amountPaise FROM customerReceipt r JOIN customer c ON c.id = r.customerId WHERE r.mode = 'cash' AND r.at >= ?2 AND r.at < ?3
     UNION ALL SELECT at, 'Refund ' || creditNoteNo, -(amountPaise - pointsValuePaise) FROM salesReturn WHERE refundMode = 'cash' AND branchId = ?1 AND at >= ?2 AND at < ?3
     UNION ALL SELECT x.at, 'Paid ' || s.name, -x.amountPaise FROM supplierPayment x JOIN supplier s ON s.id = x.supplierId WHERE x.mode = 'cash' AND x.at >= ?2 AND x.at < ?3
     UNION ALL SELECT at, category || COALESCE(' · ' || note, ''), -amountPaise FROM expense WHERE mode = 'cash' AND branchId = ?1 AND at >= ?2 AND at < ?3
     ORDER BY 1`, [branchId, from, to]).map((r) => ({ ...r, amount: n(r.amount) }));
  return { date: iso, rows, inPaise: rows.filter((r) => r.amount > 0).reduce((a, r) => a + r.amount, 0), outPaise: -rows.filter((r) => r.amount < 0).reduce((a, r) => a + r.amount, 0), netPaise: rows.reduce((a, r) => a + r.amount, 0) };
}

// ---------- reports ----------

/** Sales by day: bills, sales, GST, discount, cost and gross profit (net of returns). */
export function salesByDay(db: DriveDB, branchId: string, fromIso: string, toIso: string) {
  const [from, to] = range(fromIso, toIso);
  const days = new Map<string, { date: string; bills: number; salesPaise: number; taxPaise: number; discountPaise: number; costPaise: number; returnsPaise: number }>();
  const day = (d: string) => days.get(d) ?? days.set(d, { date: d, bills: 0, salesPaise: 0, taxPaise: 0, discountPaise: 0, costPaise: 0, returnsPaise: 0 }).get(d)!;
  for (const s of db.engine.all<{ at: string; total: number; tax: number; disc: number; cost: number }>(
    "SELECT at, totalPaise AS total, cgstPaise + sgstPaise + igstPaise AS tax, discountPaise AS disc, costPaise AS cost FROM sale WHERE branchId = ? AND at >= ? AND at < ?", [branchId, from, to])) {
    const d = day(istDate(new Date(s.at)));
    d.bills++; d.salesPaise += n(s.total); d.taxPaise += n(s.tax); d.discountPaise += n(s.disc); d.costPaise += n(s.cost);
  }
  for (const r of db.engine.all<{ at: string; amount: number }>("SELECT at, amountPaise AS amount FROM salesReturn WHERE branchId = ? AND at >= ? AND at < ?", [branchId, from, to])) day(istDate(new Date(r.at))).returnsPaise += n(r.amount);
  return [...days.values()].sort((a, b) => (a.date < b.date ? 1 : -1)).map((d) => ({ ...d, profitPaise: d.salesPaise - d.taxPaise - d.costPaise - d.returnsPaise }));
}

/** Best sellers by revenue: packs/units sold, revenue and gross profit (before GST). */
export function topMedicines(db: DriveDB, branchId: string, fromIso: string, toIso: string, limit = 20) {
  const [from, to] = range(fromIso, toIso);
  return db.engine.all<{ id: string; name: string; qty: number; revenue: number; taxable: number; cost: number }>(
    `SELECT m.id, m.name, SUM(i.qty) AS qty, SUM(i.mrpPaise * i.qty - i.discountPaise) AS revenue, SUM(i.taxablePaise) AS taxable, SUM(i.costPaise * i.qty) AS cost
       FROM saleItem i JOIN sale s ON s.id = i.saleId JOIN medicine m ON m.id = i.medicineId
      WHERE s.branchId = ? AND s.at >= ? AND s.at < ? GROUP BY m.id ORDER BY revenue DESC LIMIT ?`, [branchId, from, to, Math.max(1, Math.min(200, limit))])
    .map((r) => ({ id: r.id, name: r.name, qty: n(r.qty), revenuePaise: n(r.revenue), profitPaise: n(r.taxable) - n(r.cost) }));
}

/** Batches with stock expiring within `days` (already expired first). */
export function expiringStock(db: DriveDB, branchId: string, days = 90, today = todayISO()) {
  return db.engine.all<{ name: string; batchNo: string; expiryDate: string; qty: number; packSize: number; packUnit: string; costPaise: number }>(
    `SELECT m.name, b.batchNo, b.expiryDate, (SELECT COALESCE(SUM(qty), 0) FROM stockMovement WHERE batchId = b.id) AS qty, m.packSize, m.packUnit, b.costPaise
       FROM batch b JOIN medicine m ON m.id = b.medicineId
      WHERE b.branchId = ? AND b.deletedAt IS NULL AND b.expiryDate <= ? ORDER BY b.expiryDate`, [branchId, addDays(today, days)])
    .filter((r) => n(r.qty) > 0)
    .map((r) => ({ ...r, qty: n(r.qty), expired: r.expiryDate <= today, valuePaise: Math.round((n(r.costPaise) * n(r.qty)) / Math.max(1, n(r.packSize))) }));
}

// ---------- GST ----------

const packQty = (loose: number, packSize: number, qty: number) => (loose && packSize > 1 ? Math.round((qty / packSize) * 100) / 100 : qty);

/** This device's invoices and credit notes of a month as GST documents (same rules as the server). */
export function gstDocs(db: DriveDB, month: string, gstin: string): GstDoc[] {
  const first = `${month}-01`, next = addDays(`${month}-28`, 7).slice(0, 7) + "-01";
  const [from, to] = [istMidnight(first).toISOString(), istMidnight(next).toISOString()];
  const home = stateOf(null, gstin) ?? "";
  const meds = new Map(db.engine.all<{ id: string; hsn: string; form: string }>("SELECT id, hsn, form FROM medicine").map((m) => [m.id, m]));
  const lineOf = (medicineId: string, rate: number, qty: number, taxable: number, tax: number): GstLine & { tax: number } => {
    const m = meds.get(medicineId);
    return { hsn: (m?.hsn || "3004").replace(/\D/g, "") || "3004", desc: "", uqc: uqcFor(m?.form ?? ""), qty, rate, taxable, igst: 0, cgst: 0, sgst: 0, tax };
  };
  const split = (lines: (GstLine & { tax: number })[], cgstTotal: number, inter = false): GstLine[] => {
    if (inter) return lines.map(({ tax, ...l }) => ({ ...l, igst: tax }));
    const halves = allocateHalves(lines.map((l) => l.tax), cgstTotal);
    return lines.map(({ tax, ...l }, i) => ({ ...l, cgst: halves[i], sgst: tax - halves[i] }));
  };
  type It = { id: string; medicineId: string; qty: number; loose: number; packSize: number; mrpPaise: number; discountPaise: number; taxablePaise: number; gstRate: number };
  const itemsOf = (saleId: string) => db.engine.all<It>("SELECT id, medicineId, qty, loose, packSize, mrpPaise, discountPaise, taxablePaise, gstRate FROM saleItem WHERE saleId = ? ORDER BY rowid", [saleId]);
  const docs: GstDoc[] = [];
  for (const s of db.engine.all<{ id: string; invoiceNo: string; at: string; totalPaise: number; cgstPaise: number; igstPaise: number; pos: string | null; ctin: string | null; branchId: string }>(
    "SELECT s.id, s.invoiceNo, s.at, s.totalPaise, s.cgstPaise, s.igstPaise, s.placeOfSupply AS pos, c.gstin AS ctin, s.branchId FROM sale s LEFT JOIN customer c ON c.id = s.customerId WHERE s.at >= ? AND s.at < ? ORDER BY s.at, s.invoiceNo", [from, to])) {
    const raw = itemsOf(s.id).map((i) => lineOf(i.medicineId, i.gstRate, packQty(i.loose, i.packSize, i.qty), n(i.taxablePaise), n(i.mrpPaise) * i.qty - n(i.discountPaise) - n(i.taxablePaise)));
    const inter = n(s.igstPaise) > 0;
    docs.push({ kind: "inv", no: s.invoiceNo, date: istDate(new Date(s.at)), value: n(s.totalPaise), pos: (inter && s.pos) || home, ctin: s.ctin || null, inter, branchId: s.branchId, lines: split(raw, n(s.cgstPaise), inter) });
  }
  for (const r of db.engine.all<{ id: string; creditNoteNo: string; at: string; amountPaise: number; saleId: string; branchId: string }>(
    "SELECT id, creditNoteNo, at, amountPaise, saleId, branchId FROM salesReturn WHERE at >= ? AND at < ? ORDER BY at, creditNoteNo", [from, to])) {
    const s = db.engine.all<{ invoiceNo: string; at: string; totalPaise: number; igstPaise: number; pos: string | null; ctin: string | null }>("SELECT s.invoiceNo, s.at, s.totalPaise, s.igstPaise, s.placeOfSupply AS pos, c.gstin AS ctin FROM sale s LEFT JOIN customer c ON c.id = s.customerId WHERE s.id = ?", [r.saleId])[0];
    const items = new Map(itemsOf(r.saleId).map((i) => [i.id, i]));
    const raw = db.engine.all<{ saleItemId: string; qty: number; amountPaise: number; taxablePaise: number }>("SELECT saleItemId, qty, amountPaise, taxablePaise FROM salesReturnItem WHERE returnId = ?", [r.id]).map((l) => {
      const it = items.get(l.saleItemId)!;
      return lineOf(it.medicineId, it.gstRate, packQty(it.loose, it.packSize, l.qty), n(l.taxablePaise), n(l.amountPaise) - n(l.taxablePaise));
    });
    const tax = raw.reduce((a, l) => a + l.tax, 0), inter = n(s?.igstPaise) > 0;
    docs.push({ kind: "cn", no: r.creditNoteNo, date: istDate(new Date(r.at)), value: n(r.amountPaise), pos: (inter && s?.pos) || home, ctin: s?.ctin || null, inter, branchId: r.branchId,
      lines: split(raw, Math.floor(tax / 2), inter), orig: { no: s?.invoiceNo ?? "", date: s ? istDate(new Date(s.at)) : "", value: n(s?.totalPaise), inter, ctin: s?.ctin || null } });
  }
  return docs;
}

/** Input tax on purchase bills of the month: intra-state suppliers CGST/SGST, other states IGST. */
export function itcOf(db: DriveDB, month: string, gstin: string) {
  const home = stateOf(null, gstin);
  const out = { igst: 0, cgst: 0, sgst: 0, revIgst: 0, revCgst: 0, revSgst: 0 };
  for (const p of db.engine.all<{ tax: number; sgstin: string | null }>(
    "SELECT p.taxPaise AS tax, s.gstin AS sgstin FROM purchase p JOIN supplier s ON s.id = p.supplierId WHERE substr(p.billDate, 1, 7) = ?", [month])) {
    const tax = n(p.tax), st = stateOf(null, p.sgstin);
    if (st && home && st !== home) out.igst += tax; else { const c = Math.floor(tax / 2); out.cgst += c; out.sgst += tax - c; }
  }
  return out;
}

/** GSTR-1, GSTR-3B and the HSN summary for a month, from this device's data. */
export function gstReturns(db: DriveDB, month: string, gstin: string) {
  if (!/^\d{4}-\d{2}$/.test(month)) throw new CounterError("Pick a month.");
  const docs = gstDocs(db, month, gstin), fp = fpOf(month);
  const gstr1 = buildGstr1({ gstin, fp, docs });
  const gstr3b = buildGstr3b({ gstin, fp, docs, itc: itcOf(db, month, gstin) });
  return { month, gstin, gstr1, gstr1Summary: gstr1Summary(gstr1), gstr1Csv: gstr1Csv(gstr1), gstr3b, gstr3bRows: gstr3bRows(gstr3b), hsnCsv: hsnCsv(hsnRows(docs)), invoices: docs.filter((d) => d.kind === "inv").length, creditNotes: docs.filter((d) => d.kind === "cn").length };
}
