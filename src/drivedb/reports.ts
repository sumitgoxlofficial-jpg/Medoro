/**
 * Read-side helpers for the device screens: bill details (for printing and returns), the day-end summary,
 * bill search, stock list, customer and supplier lists, and medicine edits. All on the device database.
 */
import { einvoiceOf } from "./einvoice";
import { z } from "zod";
import { DriveDB } from "./client";
import { CounterError, stockOf, type Medicine } from "./pharmacy";
import { customerBalance, returnedQty } from "./trade";
import { addDays, istMidnight, todayISO } from "@/lib/dates";

const n = (v: unknown) => Number(v ?? 0);
const dayRange = (iso: string) => [istMidnight(iso).toISOString(), istMidnight(addDays(iso, 1)).toISOString()] as const;

export type BillLine = { id: string; medicineId: string; name: string; hsn: string; batchNo: string; expiryDate: string; qty: number; loose: number; packUnit: string; looseUnit: string; mrpPaise: number; discountPaise: number; taxablePaise: number; gstRate: number; returned: number };

/** A bill with its lines (names, batches, HSN), payments, credit notes and customer. */
export function saleDetail(db: DriveDB, saleId: string) {
  const sale = db.engine.all<Record<string, string | number | null>>("SELECT s.*, c.name AS customerName, c.phone AS customerPhone, c.gstin AS customerGstin FROM sale s LEFT JOIN customer c ON c.id = s.customerId WHERE s.id = ?", [saleId])[0];
  if (!sale) throw new CounterError("Bill not found.");
  const lines = db.engine.all<BillLine>(
    `SELECT i.id, i.medicineId, m.name, m.hsn, b.batchNo, b.expiryDate, i.qty, i.loose, m.packUnit, m.looseUnit, i.mrpPaise, i.discountPaise, i.taxablePaise, i.gstRate, 0 AS returned
       FROM saleItem i JOIN medicine m ON m.id = i.medicineId JOIN batch b ON b.id = i.batchId WHERE i.saleId = ? ORDER BY i.rowid`, [saleId])
    .map((l) => ({ ...l, returned: returnedQty(db, l.id) }));
  const payments = db.from<{ mode: string; amountPaise: number; ref: string | null }>("payment").eq("saleId", saleId).all();
  const returns = db.from<{ id: string; creditNoteNo: string; amountPaise: number; refundMode: string; at: string }>("salesReturn").eq("saleId", saleId).order("at").all();
  return { sale, lines, payments, returns, einvoice: einvoiceOf(db, saleId) };
}
export type SaleDetail = ReturnType<typeof saleDetail>;

/** Bills of one day (India time), newest first, optionally matching an invoice number, customer name or phone. */
export function listBills(db: DriveDB, iso: string, text = "", limit = 200) {
  const [from, to] = dayRange(iso);
  const q = text.trim(), esc = q.replace(/[\\%_]/g, (c) => `\\${c}`);
  return db.engine.all<{ id: string; invoiceNo: string; totalPaise: number; payMode: string; at: string; customer: string | null; items: number; returned: number }>(
    `SELECT s.id, s.invoiceNo, s.totalPaise, s.payMode, s.at, c.name AS customer,
            (SELECT COUNT(*) FROM saleItem i WHERE i.saleId = s.id) AS items,
            (SELECT COALESCE(SUM(r.amountPaise), 0) FROM salesReturn r WHERE r.saleId = s.id) AS returned
       FROM sale s LEFT JOIN customer c ON c.id = s.customerId
      WHERE s.at >= ? AND s.at < ? ${q ? "AND (s.invoiceNo LIKE ?3 ESCAPE '\\' OR c.name LIKE ?3 ESCAPE '\\' OR c.phone LIKE ?3 ESCAPE '\\')" : ""}
      ORDER BY s.at DESC LIMIT ${Math.max(1, Math.min(1000, Math.floor(limit)))}`,
    q ? [from, to, `%${esc}%`] : [from, to]);
}

/** Day-end summary: bills and takings by payment mode, returns by refund mode, cash to hand over, purchases. */
export function dayReport(db: DriveDB, branchId: string, iso = todayISO()) {
  const [from, to] = dayRange(iso);
  const sales = db.engine.all<{ bills: number; total: number; tax: number; discount: number }>(
    "SELECT COUNT(*) AS bills, COALESCE(SUM(totalPaise), 0) AS total, COALESCE(SUM(cgstPaise + sgstPaise + igstPaise), 0) AS tax, COALESCE(SUM(discountPaise), 0) AS discount FROM sale WHERE branchId = ? AND at >= ? AND at < ?",
    [branchId, from, to])[0];
  const pay = Object.fromEntries(db.engine.all<{ mode: string; amount: number }>(
    "SELECT p.mode, SUM(p.amountPaise) AS amount FROM payment p JOIN sale s ON s.id = p.saleId WHERE s.branchId = ? AND s.at >= ? AND s.at < ? GROUP BY p.mode",
    [branchId, from, to]).map((r) => [r.mode, n(r.amount)])) as Record<string, number>;
  const refunds = Object.fromEntries(db.engine.all<{ mode: string; amount: number }>(
    "SELECT refundMode AS mode, SUM(amountPaise - pointsValuePaise) AS amount FROM salesReturn WHERE branchId = ? AND at >= ? AND at < ? GROUP BY refundMode",
    [branchId, from, to]).map((r) => [r.mode, n(r.amount)])) as Record<string, number>;
  const received = db.engine.all<{ mode: string; amount: number }>(
    "SELECT mode, SUM(amountPaise) AS amount FROM customerReceipt WHERE at >= ? AND at < ? GROUP BY mode", [from, to]);
  const receipts = Object.fromEntries(received.map((r) => [r.mode, n(r.amount)])) as Record<string, number>;
  const returns = db.engine.all<{ count: number }>("SELECT COUNT(*) AS count FROM salesReturn WHERE branchId = ? AND at >= ? AND at < ?", [branchId, from, to])[0];
  const purchases = db.engine.all<{ count: number; total: number }>("SELECT COUNT(*) AS count, COALESCE(SUM(totalPaise), 0) AS total FROM purchase WHERE branchId = ? AND at >= ? AND at < ?", [branchId, from, to])[0];
  const cashOut = db.engine.all<{ suppliers: number; expenses: number }>(
    `SELECT (SELECT COALESCE(SUM(amountPaise), 0) FROM supplierPayment WHERE mode = 'cash' AND at >= ?2 AND at < ?3) AS suppliers,
            (SELECT COALESCE(SUM(amountPaise), 0) FROM expense WHERE mode = 'cash' AND branchId = ?1 AND at >= ?2 AND at < ?3) AS expenses`, [branchId, from, to])[0];
  const m = (o: Record<string, number>, k: string) => o[k] ?? 0;
  return {
    date: iso, bills: n(sales.bills), totalPaise: n(sales.total), taxPaise: n(sales.tax), discountPaise: n(sales.discount),
    byMode: { cash: m(pay, "cash"), upi: m(pay, "upi"), card: m(pay, "card"), credit: m(pay, "credit") },
    returns: { count: n(returns.count), cash: m(refunds, "cash"), upi: m(refunds, "upi"), credit: m(refunds, "credit") },
    receipts: { cash: m(receipts, "cash"), upi: m(receipts, "upi"), card: m(receipts, "card") },
    /** Cash paid out of the drawer: to suppliers and for expenses. */
    paidOut: { suppliers: n(cashOut.suppliers), expenses: n(cashOut.expenses) },
    /** Cash that should be in the drawer from today's work: cash bills + cash received − cash refunds − cash paid out. */
    cashInHandPaise: m(pay, "cash") + m(receipts, "cash") - m(refunds, "cash") - n(cashOut.suppliers) - n(cashOut.expenses),
    purchases: { count: n(purchases.count), totalPaise: n(purchases.total) },
  };
}
export type DayReport = ReturnType<typeof dayReport>;

/** Medicines with stock for the stock screen; `low` = at or below the reorder level. */
export function stockList(db: DriveDB, branchId: string, text = "", limit = 100, today = todayISO()) {
  const q = text.trim(), esc = q.replace(/[\\%_]/g, (c) => `\\${c}`);
  const meds = db.engine.all<Medicine>(
    `SELECT * FROM medicine WHERE deletedAt IS NULL ${q ? "AND (name LIKE ? ESCAPE '\\' OR generic LIKE ? ESCAPE '\\' OR barcode = ?)" : ""} ORDER BY name COLLATE NOCASE LIMIT ${Math.max(1, Math.min(1000, Math.floor(limit)))}`,
    q ? [`%${esc}%`, `${esc}%`, q] : []);
  return meds.map((m) => {
    const stock = stockOf(db, m.id, branchId, today);
    const next = db.engine.all<{ expiryDate: string }>(
      "SELECT b.expiryDate FROM batch b WHERE b.medicineId = ? AND b.branchId = ? AND b.deletedAt IS NULL AND b.status = 'ok' AND b.expiryDate > ? AND (SELECT COALESCE(SUM(qty), 0) FROM stockMovement WHERE batchId = b.id) > 0 ORDER BY b.expiryDate LIMIT 1",
      [m.id, branchId, today])[0]?.expiryDate ?? null;
    return { ...m, stock, nextExpiry: next, low: stock <= m.reorderLevel * Math.max(1, m.packSize) };
  });
}

export const medicinePatch = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  mrpPaise: z.number().int().min(0).max(10_000_000_00).optional(),
  gstRate: z.union([z.literal(0), z.literal(5), z.literal(12), z.literal(18), z.literal(28)]).optional(),
  reorderLevel: z.number().int().min(0).max(100_000).optional(),
  rack: z.string().trim().max(20).nullable().optional(),
  barcode: z.string().trim().max(40).nullable().optional(),
  schedule: z.string().trim().max(10).nullable().optional(),
  active: z.boolean().optional(),
});

/** Edits a medicine (price, GST, reorder level, rack, barcode, schedule, active). */
export function updateMedicine(db: DriveDB, id: string, patch: z.input<typeof medicinePatch>) {
  const p = medicinePatch.parse(patch);
  if (p.barcode && db.from("medicine").eq("barcode", p.barcode).neq("id", id).count()) throw new CounterError(`Barcode ${p.barcode} is already on another medicine.`);
  if (!db.from("medicine").eq("id", id).count()) throw new CounterError("Medicine not found.");
  db.from("medicine").eq("id", id).update(p);
  return db.from<Medicine>("medicine").eq("id", id).first()!;
}

/** Customers A–Z (or matching text) with what each owes. */
export function customerList(db: DriveDB, text = "", limit = 100) {
  const q = text.trim(), esc = q.replace(/[\\%_]/g, (c) => `\\${c}`);
  return db.engine.all<{ id: string; name: string; phone: string | null; gstin: string | null; creditLimitPaise: number }>(
    `SELECT id, name, phone, gstin, creditLimitPaise FROM customer WHERE deletedAt IS NULL ${q ? "AND (phone LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\')" : ""} ORDER BY name COLLATE NOCASE LIMIT ${Math.max(1, Math.min(1000, Math.floor(limit)))}`,
    q ? [`${esc}%`, `%${esc}%`] : []).map((c) => ({ ...c, balancePaise: customerBalance(db, c.id) }));
}

export const supplierList = (db: DriveDB) => db.from<{ id: string; name: string; gstin: string | null; phone: string | null }>("supplier").select("id,name,gstin,phone").order("name").all();

const KIND_LABEL: Record<string, string> = { adjust: "Stock corrected", count: "Stock count", transfer_out: "Sent to another branch", transfer_in: "Received from another branch" };

/**
 * Who did what, newest first: bills, credit notes, purchases, money received and paid, expenses, stock corrections,
 * counts, transfers and delivery orders. Names come from the staff list copied with the catalogue.
 */
export function activityLog(db: DriveDB, opts: { limit?: number; text?: string } = {}) {
  const names = new Map((JSON.parse(db.getMeta("users") ?? "[]") as { id: string; name: string }[]).map((u) => [u.id, u.name]));
  const rows = db.engine.all<{ at: string; userId: string; kind: string; what: string; amount: number | null }>(
    `SELECT at, userId, 'bill' AS kind, 'Bill ' || invoiceNo || COALESCE(' · ' || (SELECT name FROM customer c WHERE c.id = s.customerId), '') AS what, totalPaise AS amount FROM sale s
     UNION ALL SELECT at, userId, 'return', 'Credit note ' || creditNoteNo || ' (' || reason || ')', -amountPaise FROM salesReturn
     UNION ALL SELECT p.at, p.userId, 'purchase', 'Purchase bill ' || p.billNo || ' · ' || s.name, p.totalPaise FROM purchase p JOIN supplier s ON s.id = p.supplierId
     UNION ALL SELECT r.at, r.userId, 'received', 'Received from ' || c.name || ' (' || r.mode || ')', r.amountPaise FROM customerReceipt r JOIN customer c ON c.id = r.customerId
     UNION ALL SELECT x.at, x.userId, 'paid', 'Paid ' || s.name || ' (' || x.mode || ')', -x.amountPaise FROM supplierPayment x JOIN supplier s ON s.id = x.supplierId
     UNION ALL SELECT at, userId, 'expense', category || COALESCE(' · ' || note, ''), -amountPaise FROM expense
     UNION ALL SELECT m.at, m.userId, m.type, m.type || '|' || m.qty || ' · ' || md.name || ' (batch ' || b.batchNo || ')' || COALESCE(' · ' || m.refType, '') || COALESCE(' · ' || m.note, ''), NULL
       FROM stockMovement m JOIN batch b ON b.id = m.batchId JOIN medicine md ON md.id = b.medicineId WHERE m.type IN ('adjust', 'count', 'transfer_out', 'transfer_in')
     UNION ALL SELECT o.createdAt, '', 'order', 'Delivery order ' || o.orderNo || ' · ' || c.name || ' · ' || o.status, NULL FROM deliveryOrder o JOIN customer c ON c.id = o.customerId
     ORDER BY 1 DESC LIMIT ?`, [Math.max(1, Math.min(1000, opts.limit ?? 200))]);
  const q = (opts.text ?? "").trim().toLowerCase();
  return rows.map((r) => {
    const label = KIND_LABEL[r.kind];
    const what = label ? `${label}: ${r.what.slice(r.what.indexOf("|") + 1)}` : r.what;
    return { at: r.at, who: names.get(r.userId) ?? (r.userId === "online" ? "Online payment" : r.userId ? "Staff" : ""), kind: r.kind, what, amountPaise: r.amount == null ? null : Number(r.amount) };
  }).filter((r) => !q || r.what.toLowerCase().includes(q) || r.who.toLowerCase().includes(q));
}
