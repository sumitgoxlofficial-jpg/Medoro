/**
 * Day-to-day stock work and home delivery on the device database (DriveDB phase 5).
 *   - Stock corrections (damaged, expired, lost, found) and physical counts: always as stock movements, so
 *     every counter's view adds up and nothing is overwritten.
 *   - Blocking batches (quarantine, recall) from sale, and releasing them.
 *   - Delivery orders: taken by phone/WhatsApp, billed when packed (prepaid as cash/UPI; cash on delivery as a
 *     bill on the customer's account, settled when the rider brings the cash), then out and delivered.
 */
import { z } from "zod";
import { DriveDB } from "./client";
import { CounterError, batchesOf, createSale, type Medicine } from "./pharmacy";
import { customerBalance, receivePayment } from "./trade";

const now = () => new Date().toISOString();

// ---------- stock corrections and counts ----------

export const ADJUST_REASONS = ["damaged", "expired", "lost", "found", "sample", "other"] as const;
export const adjustInput = z.object({
  branchId: z.string().min(1), batchId: z.string().min(1), userId: z.string().min(1),
  /** Stock units: negative takes stock out, positive puts it in (found). */
  qty: z.number().int().refine((n) => n !== 0, "Enter how many."),
  reason: z.enum(ADJUST_REASONS), note: z.string().trim().max(200).optional(),
});

/** Corrects one batch's stock with a reason. Can't take out more than is there. */
export function adjustStock(db: DriveDB, input: z.input<typeof adjustInput>) {
  const a = adjustInput.parse(input);
  if (a.reason === "found" ? a.qty < 0 : a.qty > 0 && a.reason !== "other") throw new CounterError(a.reason === "found" ? "Found stock is added: enter a positive number." : "That reason takes stock out: enter a negative number.");
  return db.transaction(() => {
    const b = db.engine.all<{ id: string; medicineId: string }>("SELECT id, medicineId FROM batch WHERE id = ? AND branchId = ?", [a.batchId, a.branchId])[0];
    if (!b) throw new CounterError("Batch not found in this branch.");
    const have = batchesOf(db, b.medicineId, a.branchId).find((x) => x.id === b.id)!.qtyAvailable;
    if (have + a.qty < 0) throw new CounterError(`Only ${have} in this batch.`);
    db.from("stockMovement").insert({ branchId: a.branchId, batchId: b.id, qty: a.qty, type: "adjust", refType: a.reason, refId: b.id, userId: a.userId, at: now(), note: a.note ?? null });
    return { qtyAvailable: have + a.qty };
  });
}

export const countInput = z.object({
  branchId: z.string().min(1), userId: z.string().min(1),
  /** Counted stock units per batch. */
  counts: z.array(z.object({ batchId: z.string().min(1), counted: z.number().int().min(0).max(10_000_000) })).min(1).max(2000),
});

/** Records a physical stock count: each batch's difference goes in as one movement. Returns the differences. */
export function recordCount(db: DriveDB, input: z.input<typeof countInput>) {
  const c = countInput.parse(input);
  return db.transaction(() => {
    const countId = globalThis.crypto.randomUUID(), at = now();
    const diffs: { batchId: string; system: number; counted: number; diff: number }[] = [];
    for (const x of c.counts) {
      const b = db.engine.all<{ medicineId: string }>("SELECT medicineId FROM batch WHERE id = ? AND branchId = ?", [x.batchId, c.branchId])[0];
      if (!b) throw new CounterError("A counted batch isn’t in this branch.");
      const system = batchesOf(db, b.medicineId, c.branchId).find((y) => y.id === x.batchId)!.qtyAvailable;
      const diff = x.counted - system;
      if (diff) db.from("stockMovement").insert({ branchId: c.branchId, batchId: x.batchId, qty: diff, type: "count", refType: "count", refId: countId, userId: c.userId, at, note: `Counted ${x.counted}, system ${system}` });
      diffs.push({ batchId: x.batchId, system, counted: x.counted, diff });
    }
    return { countId, diffs };
  });
}

/** A medicine's batches with stock and status, for the stock correction screen. */
export const batchesFor = (db: DriveDB, medicineId: string, branchId: string) => batchesOf(db, medicineId, branchId);

/** Blocks a batch from sale (quarantine, recall) or releases it (ok). Expired batches are blocked automatically. */
export function setBatchStatus(db: DriveDB, batchId: string, status: "ok" | "quarantine" | "recalled") {
  if (!["ok", "quarantine", "recalled"].includes(status)) throw new CounterError("Unknown status.");
  if (!db.from("batch").eq("id", batchId).count()) throw new CounterError("Batch not found.");
  db.from("batch").eq("id", batchId).update({ status });
  return status;
}

// ---------- delivery orders ----------

export const orderInput = z.object({
  branchId: z.string().min(1), series: z.string().min(1), customerId: z.string().min(1),
  address: z.string().trim().min(5, "Enter the delivery address.").max(300), note: z.string().trim().max(200).optional(),
  payment: z.enum(["cod", "upi", "cash"]),
  items: z.array(z.object({ medicineId: z.string().min(1), qty: z.number().int().min(1).max(1000), unit: z.enum(["pack", "loose"]).default("pack") })).min(1, "Add at least one item.").max(100),
});
export type Order = { id: string; orderNo: string; customerId: string; address: string; note: string | null; payment: string; status: string; saleId: string | null; rider: string | null; createdAt: string };

/** Takes a delivery order. Numbered per counter (series-O-n). Stock is taken when it's billed at packing. */
export function createOrder(db: DriveDB, input: z.input<typeof orderInput>) {
  const o = orderInput.parse(input);
  return db.transaction(() => {
    if (!db.from("customer").eq("id", o.customerId).count()) throw new CounterError("Customer not found.");
    for (const i of o.items) if (!db.from<Medicine>("medicine").eq("id", i.medicineId).first()) throw new CounterError("A medicine on the order isn’t in the catalogue.");
    const orderNo = `${o.series}-O${db.nextSeq(`ORD:${o.series}`)}`;
    const order = db.from<Order>("deliveryOrder").insert({ branchId: o.branchId, orderNo, customerId: o.customerId, address: o.address, note: o.note ?? null, payment: o.payment, status: "new", saleId: null, rider: null, createdAt: now() })[0];
    db.from("deliveryOrderItem").insert(o.items.map((i) => ({ orderId: order.id, medicineId: i.medicineId, qty: i.qty, unit: i.unit })));
    return order;
  });
}

const order = (db: DriveDB, id: string) => { const o = db.from<Order>("deliveryOrder").eq("id", id).first(); if (!o) throw new CounterError("Order not found."); return o; };

/** Packs and bills the order (FEFO, same checks as the counter). Cash on delivery goes on the customer's account. */
export function packOrder(db: DriveDB, input: { orderId: string; userId: string; series: string; maxDiscountPct?: number; prescriber?: string; prescriberReg?: string; patientName?: string }) {
  return db.transaction(() => {
    const o = order(db, input.orderId);
    if (o.status !== "new") throw new CounterError(`Order ${o.orderNo} is already ${o.status}.`);
    const items = db.from<{ medicineId: string; qty: number; unit: "pack" | "loose" }>("deliveryOrderItem").eq("orderId", o.id).all();
    // A cash-on-delivery bill sits on the customer's account until the rider collects.
    const sale = createSale(db, {
      branchId: db.from<{ branchId: string }>("deliveryOrder").eq("id", o.id).first()!.branchId, series: input.series, userId: input.userId, customerId: o.customerId,
      lines: items.map((i) => ({ medicineId: i.medicineId, qty: i.qty, unit: i.unit })), maxDiscountPct: input.maxDiscountPct ?? 100,
      pay: { mode: o.payment === "cod" ? "credit" : (o.payment as "cash" | "upi") }, prescriber: input.prescriber, prescriberReg: input.prescriberReg, patientName: input.patientName,
      codDelivery: o.payment === "cod",
    });
    db.from("deliveryOrder").eq("id", o.id).update({ status: "packed", saleId: sale.saleId });
    return sale;
  });
}

export function dispatchOrder(db: DriveDB, orderId: string, rider: string) {
  const o = order(db, orderId);
  if (o.status !== "packed") throw new CounterError("Pack and bill the order first.");
  if (!rider.trim()) throw new CounterError("Enter who is delivering it.");
  db.from("deliveryOrder").eq("id", o.id).update({ status: "out", rider: rider.trim().slice(0, 60) });
  return true;
}

/** Marks delivered; for cash on delivery the rider's cash is recorded against the bill. */
export function deliverOrder(db: DriveDB, orderId: string, userId: string) {
  return db.transaction(() => {
    const o = order(db, orderId);
    if (o.status !== "out") throw new CounterError("The order isn’t out for delivery.");
    if (o.payment === "cod" && o.saleId) {
      const total = Number(db.engine.all<{ t: number }>("SELECT COALESCE(SUM(amountPaise), 0) AS t FROM payment WHERE saleId = ? AND mode = 'credit'", [o.saleId])[0].t);
      const owed = customerBalance(db, o.customerId);
      if (total > 0 && owed > 0) receivePayment(db, { customerId: o.customerId, amountPaise: Math.min(total, owed), mode: "cash", ref: o.orderNo, userId });
    }
    db.from("deliveryOrder").eq("id", o.id).update({ status: "delivered" });
    return true;
  });
}

/** Cancels an order that hasn't been billed. A billed order is returned through Bills → Return. */
export function cancelOrder(db: DriveDB, orderId: string) {
  const o = order(db, orderId);
  if (o.status !== "new") throw new CounterError("Only an order that hasn’t been packed can be cancelled. Take a return from its bill instead.");
  db.from("deliveryOrder").eq("id", o.id).update({ status: "cancelled" });
  return true;
}

/** Open and recent orders with customer, items and bill total. */
export function listOrders(db: DriveDB, branchId: string, showDone = false) {
  const rows = db.engine.all<Order & { customer: string; phone: string | null; total: number | null; invoiceNo: string | null }>(
    `SELECT o.*, c.name AS customer, c.phone, s.totalPaise AS total, s.invoiceNo FROM deliveryOrder o JOIN customer c ON c.id = o.customerId LEFT JOIN sale s ON s.id = o.saleId
      WHERE o.branchId = ? AND o.deletedAt IS NULL ${showDone ? "" : "AND o.status IN ('new', 'packed', 'out')"} ORDER BY o.createdAt DESC LIMIT 200`, [branchId]);
  return rows.map((r) => ({
    ...r, total: r.total == null ? null : Number(r.total),
    items: db.engine.all<{ name: string; qty: number; unit: string }>("SELECT m.name, i.qty, i.unit FROM deliveryOrderItem i JOIN medicine m ON m.id = i.medicineId WHERE i.orderId = ?", [r.id]),
  }));
}

// ---------- branch transfers ----------

export const transferInput = z.object({
  fromBranchId: z.string().min(1), toBranchId: z.string().min(1), batchId: z.string().min(1), userId: z.string().min(1),
  /** Stock units. */
  qty: z.number().int().min(1).max(10_000_000), note: z.string().trim().max(200).optional(),
});

/**
 * Moves stock of one batch to another branch: out here, in there (the same batch number and expiry). The other
 * branch's counters see it after their next sync.
 */
export function transferStock(db: DriveDB, input: z.input<typeof transferInput>) {
  const t = transferInput.parse(input);
  if (t.fromBranchId === t.toBranchId) throw new CounterError("Pick another branch to send the stock to.");
  return db.transaction(() => {
    const b = db.engine.all<{ id: string; medicineId: string; batchNo: string; expiryDate: string; costPaise: number; mrpPaise: number; status: string }>(
      "SELECT id, medicineId, batchNo, expiryDate, costPaise, mrpPaise, status FROM batch WHERE id = ? AND branchId = ?", [t.batchId, t.fromBranchId])[0];
    if (!b) throw new CounterError("Batch not found in this branch.");
    if (b.status !== "ok") throw new CounterError("A blocked batch can’t be transferred. Release it first.");
    const have = batchesOf(db, b.medicineId, t.fromBranchId).find((x) => x.id === b.id)!.qtyAvailable;
    if (t.qty > have) throw new CounterError(`Only ${have} in this batch.`);
    const there = db.from<{ id: string }>("batch").eq("branchId", t.toBranchId).eq("medicineId", b.medicineId).eq("batchNo", b.batchNo).first();
    const toBatch = there?.id ?? db.from<{ id: string }>("batch").insert({ branchId: t.toBranchId, medicineId: b.medicineId, batchNo: b.batchNo, expiryDate: b.expiryDate, costPaise: b.costPaise, mrpPaise: b.mrpPaise, supplierId: null, status: "ok" })[0].id;
    const transferId = globalThis.crypto.randomUUID(), at = now();
    db.from("stockMovement").insert([
      { branchId: t.fromBranchId, batchId: b.id, qty: -t.qty, type: "transfer_out", refType: "transfer", refId: transferId, userId: t.userId, at, note: t.note ?? null },
      { branchId: t.toBranchId, batchId: toBatch, qty: t.qty, type: "transfer_in", refType: "transfer", refId: transferId, userId: t.userId, at, note: t.note ?? null },
    ]);
    return { transferId, toBatchId: toBatch, left: have - t.qty };
  });
}
