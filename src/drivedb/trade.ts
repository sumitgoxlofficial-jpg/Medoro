/**
 * Customers (credit and payments received), suppliers and purchase bills (stock in), and sales returns
 * (credit notes) on the device database. Same rules as the server: returns refund the share actually paid
 * after discount, restock only sealed and unexpired goods, and never return more than was sold.
 */
import { z } from "zod";
import { DriveDB } from "./client";
import { CounterError, receiveStock, type Medicine } from "./pharmacy";
import { shareOf } from "@/lib/money";
import { daysTo, fiscalYear, todayISO } from "@/lib/dates";
import { gstDocNo, validSeries } from "@/lib/docno";
import { validGstin } from "@/domain/accounting/gst";

const money = z.number().int().min(0).max(10_000_000_00);
const phone = z.string().trim().regex(/^[6-9]\d{9}$/, "Enter a 10-digit mobile number.");
const gstin = z.string().trim().toUpperCase().refine(validGstin, "That GSTIN isn’t valid.");
const one = (n: unknown) => Number(n ?? 0);

// ---------- customers ----------

export const customerInput = z.object({
  name: z.string().trim().min(1, "Enter the customer’s name.").max(120),
  phone: phone.nullable().default(null),
  gstin: gstin.nullable().default(null),
  creditLimitPaise: money.default(0),
});
export type Customer = { id: string; name: string; phone: string | null; gstin: string | null; creditLimitPaise: number };

export function addCustomer(db: DriveDB, input: z.input<typeof customerInput>): Customer {
  const c = customerInput.parse(input);
  if (c.phone && db.from("customer").eq("phone", c.phone).count()) throw new CounterError(`${c.phone} is already saved for another customer.`);
  return db.from<Customer>("customer").insert(c)[0];
}

/** Customers by mobile number (exact or starting digits) or name. */
export function findCustomers(db: DriveDB, text: string, limit = 20): Customer[] {
  const q = text.trim();
  if (!q) return [];
  const esc = q.replace(/[\\%_]/g, (c) => `\\${c}`);
  return db.engine.all<Customer>(
    "SELECT id, name, phone, gstin, creditLimitPaise FROM customer WHERE deletedAt IS NULL AND (phone LIKE ? ESCAPE '\\' OR name LIKE ? ESCAPE '\\') ORDER BY name COLLATE NOCASE LIMIT ?",
    [`${esc}%`, `%${esc}%`, limit]);
}

/** What a customer owes: credit bills, less payments received and returns credited to their account. */
export function customerBalance(db: DriveDB, customerId: string): number {
  const r = db.engine.all<{ credit: number; paid: number; returned: number }>(
    `SELECT
       (SELECT COALESCE(SUM(p.amountPaise), 0) FROM payment p JOIN sale s ON s.id = p.saleId WHERE s.customerId = ?1 AND p.mode = 'credit') AS credit,
       (SELECT COALESCE(SUM(amountPaise), 0) FROM customerReceipt WHERE customerId = ?1) AS paid,
       (SELECT COALESCE(SUM(r.amountPaise), 0) FROM salesReturn r JOIN sale s ON s.id = r.saleId WHERE s.customerId = ?1 AND r.refundMode = 'credit') AS returned`,
    [customerId])[0];
  return one(r.credit) - one(r.paid) - one(r.returned);
}

export const receiptInput = z.object({
  customerId: z.string().min(1),
  amountPaise: z.number().int().min(100, "Enter at least ₹1.").max(10_000_000_00),
  mode: z.enum(["cash", "upi", "card"]),
  ref: z.string().trim().max(60).optional(),
  userId: z.string().min(1),
});

/** Records money received from a credit customer. Refuses more than they owe. */
export function receivePayment(db: DriveDB, input: z.input<typeof receiptInput>) {
  const r = receiptInput.parse(input);
  return db.transaction(() => {
    const c = db.from<Customer>("customer").eq("id", r.customerId).first();
    if (!c) throw new CounterError("Customer not found.");
    const due = customerBalance(db, c.id);
    if (r.amountPaise > due) throw new CounterError(`${c.name} owes only ₹${(due / 100).toFixed(2)}.`);
    const row = db.from<{ id: string }>("customerReceipt").insert({ customerId: c.id, amountPaise: r.amountPaise, mode: r.mode, ref: r.ref ?? null, userId: r.userId, at: new Date().toISOString() })[0];
    return { id: row.id, balancePaise: due - r.amountPaise };
  });
}

// ---------- suppliers and purchases ----------

export const supplierInput = z.object({
  name: z.string().trim().min(1, "Enter the supplier’s name.").max(120),
  phone: phone.nullable().default(null),
  gstin: gstin.nullable().default(null),
  dl: z.string().trim().max(60).nullable().default(null),
  address: z.string().trim().max(300).nullable().default(null),
});
export type Supplier = { id: string; name: string; gstin: string | null };

export function addSupplier(db: DriveDB, input: z.input<typeof supplierInput>): Supplier {
  const s = supplierInput.parse(input);
  if (s.gstin && db.from("supplier").eq("gstin", s.gstin).count()) throw new CounterError(`A supplier with GSTIN ${s.gstin} is already saved.`);
  return db.from<Supplier>("supplier").insert(s)[0];
}

export const purchaseInput = z.object({
  branchId: z.string().min(1),
  supplierId: z.string().min(1),
  billNo: z.string().trim().min(1, "Enter the supplier’s bill number.").max(40),
  billDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-01."),
  userId: z.string().min(1),
  lines: z.array(z.object({
    medicineId: z.string().min(1),
    batchNo: z.string().trim().min(1, "Enter the batch number.").max(40),
    expiryDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2027-03-31."),
    packs: z.number().int().min(1).max(100_000),
    freePacks: z.number().int().min(0).max(100_000).default(0),
    /** Rate per pack before GST, as on the supplier's bill. */
    costPaise: money,
    mrpPaise: money,
  })).min(1, "Add at least one item.").max(300),
});

/**
 * Enters a supplier's bill: adds every line to stock (paid and free packs) and records the bill with its GST.
 * The same bill number can't be entered twice for one supplier.
 */
export function recordPurchase(db: DriveDB, input: z.input<typeof purchaseInput>, today = todayISO()) {
  const p = purchaseInput.parse(input);
  if (p.billDate > today) throw new CounterError("The bill date can’t be in the future.");
  return db.transaction(() => {
    if (!db.from("supplier").eq("id", p.supplierId).count()) throw new CounterError("Supplier not found.");
    if (db.from("purchase").eq("supplierId", p.supplierId).eq("billNo", p.billNo).count()) throw new CounterError(`Bill ${p.billNo} from this supplier is already entered.`);
    const purchaseId = globalThis.crypto.randomUUID();
    const items: Record<string, string | number | null>[] = [];
    let taxable = 0, tax = 0;
    for (const l of p.lines) {
      const m = db.from<Medicine>("medicine").eq("id", l.medicineId).first();
      if (!m) throw new CounterError("A medicine on the bill isn’t in the catalogue.");
      if (l.expiryDate <= today) throw new CounterError(`${m.name} batch ${l.batchNo} has already expired.`);
      if (l.costPaise > l.mrpPaise) throw new CounterError(`${m.name}: the purchase rate is more than the MRP. Check the line.`);
      const batchId = receiveStock(db, {
        branchId: p.branchId, medicineId: m.id, batchNo: l.batchNo, expiryDate: l.expiryDate, qty: (l.packs + l.freePacks) * m.packSize,
        costPaise: l.costPaise, mrpPaise: l.mrpPaise, type: "grn", refId: purchaseId, userId: p.userId,
      });
      const tb = l.costPaise * l.packs, tx = Math.round((tb * m.gstRate) / 100);
      taxable += tb; tax += tx;
      items.push({ purchaseId, batchId, medicineId: m.id, packs: l.packs, freePacks: l.freePacks, costPaise: l.costPaise, mrpPaise: l.mrpPaise, gstRate: m.gstRate, taxablePaise: tb, taxPaise: tx });
    }
    db.from("purchase").insert({ id: purchaseId, branchId: p.branchId, supplierId: p.supplierId, billNo: p.billNo, billDate: p.billDate, taxablePaise: taxable, taxPaise: tax, totalPaise: taxable + tax, userId: p.userId, at: new Date().toISOString() });
    db.from("purchaseItem").insert(items);
    return { purchaseId, taxablePaise: taxable, taxPaise: tax, totalPaise: taxable + tax };
  });
}

// ---------- sales returns ----------

export const returnInput = z.object({
  saleId: z.string().min(1),
  series: z.string().refine(validSeries, "Counter series must be 1–5 letters or digits, starting with a letter."),
  userId: z.string().min(1),
  reason: z.string().trim().min(1, "Enter the reason for the return.").max(200),
  condition: z.enum(["sealed", "opened", "damaged"]),
  /** cash/upi: money back now. credit: reduces what the customer owes (credit customers only). */
  refundMode: z.enum(["cash", "upi", "credit"]),
  lines: z.array(z.object({ saleItemId: z.string().min(1), qty: z.number().int().min(1).max(10000) })).min(1, "Pick at least one item to return.").max(200),
});

type SaleItem = { id: string; saleId: string; batchId: string; qty: number; loose: number; packSize: number; mrpPaise: number; discountPaise: number; taxablePaise: number };

/** Quantity of a bill line already returned. */
export const returnedQty = (db: DriveDB, saleItemId: string) =>
  one(db.engine.all<{ n: number }>("SELECT COALESCE(SUM(qty), 0) AS n FROM salesReturnItem WHERE saleItemId = ?", [saleItemId])[0].n);

/** Issues a credit note: refunds the share paid after discount, reverses GST, restocks sealed unexpired goods. */
export function createReturn(db: DriveDB, input: z.input<typeof returnInput>, today = todayISO()) {
  const r = returnInput.parse(input);
  return db.transaction(() => {
    const sale = db.from<{ id: string; branchId: string; customerId: string | null; invoiceNo: string }>("sale").eq("id", r.saleId).first();
    if (!sale) throw new CounterError("Bill not found.");
    if (r.refundMode === "credit" && !sale.customerId) throw new CounterError("Only a bill with a customer can be credited to their account. Refund cash or UPI.");
    const returnId = globalThis.crypto.randomUUID(), at = new Date().toISOString();
    const lines: Record<string, string | number | null>[] = [];
    const movements: Record<string, string | number | null>[] = [];
    let amount = 0, taxable = 0;
    const seen = new Set<string>();
    for (const w of r.lines) {
      if (seen.has(w.saleItemId)) throw new CounterError("The same bill line is listed twice.");
      seen.add(w.saleItemId);
      const it = db.from<SaleItem>("saleItem").eq("id", w.saleItemId).first();
      if (!it || it.saleId !== sale.id) throw new CounterError(`That item isn’t on bill ${sale.invoiceNo}.`);
      const done = returnedQty(db, it.id);
      if (w.qty > it.qty - done) throw new CounterError(`Only ${it.qty - done} of that item can still be returned.`);
      const net = it.mrpPaise * it.qty - it.discountPaise;
      const amt = shareOf(net, it.qty, done, w.qty), tb = shareOf(it.taxablePaise, it.qty, done, w.qty);
      const b = db.from<{ id: string; expiryDate: string; status: string }>("batch").withDeleted().eq("id", it.batchId).first();
      const restock = r.condition === "sealed" && !!b && b.status === "ok" && daysTo(b.expiryDate, today) > 0;
      const units = it.loose ? w.qty : w.qty * it.packSize;
      amount += amt; taxable += tb;
      lines.push({ returnId, saleItemId: it.id, batchId: it.batchId, qty: w.qty, amountPaise: amt, taxablePaise: tb, restocked: restock ? 1 : 0 });
      if (restock) movements.push({ branchId: sale.branchId, batchId: it.batchId, qty: units, type: "return", refType: "sales_return", refId: returnId, userId: r.userId, at, note: "Sales return, restocked" });
    }
    const fy = fiscalYear(today);
    const creditNoteNo = gstDocNo(`CN${r.series}`, fy, db.nextSeq(`CN:${r.series}:${fy}`), 4);
    db.from("salesReturn").insert({
      id: returnId, saleId: sale.id, branchId: sale.branchId, deviceId: db.device, creditNoteNo, reason: r.reason, condition: r.condition,
      refundMode: r.refundMode, amountPaise: amount, taxablePaise: taxable, userId: r.userId, at,
    });
    db.from("salesReturnItem").insert(lines);
    if (movements.length) db.from("stockMovement").insert(movements);
    return { returnId, creditNoteNo, amountPaise: amount, restocked: lines.filter((l) => l.restocked).length };
  });
}
