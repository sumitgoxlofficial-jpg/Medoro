import { beforeEach, describe, expect, it } from "vitest";
import { memoryDb } from "./node";
import type { DriveDB } from "./client";
import { addMedicine, receiveStock } from "./pharmacy";
import { addCustomer, customerBalance } from "./trade";
import { cancelInvoice, creditFor, directInvoice, invoiceView, reservedUnits, saveChemist, saveProduct, saveScheme } from "./dist";
import { approveOrder, cancelOrder, confirmPickLine, invoiceOrder, listOrders, packOrder, pickList, placeOrder, rejectOrder, startPicking, statusOf } from "./dist-orders";
import { addDays, todayISO } from "@/lib/dates";

const G = "godown-1", U = "u1", today = todayISO();
let db: DriveDB, med = "", chem = "", n = 0;
const key = () => `order-key-${++n}-${Date.now()}`;
const stockUnits = (batch: string) => Number(db.engine.all<{ q: number }>("SELECT COALESCE(SUM(qty), 0) AS q FROM stockMovement WHERE batchId = (SELECT id FROM batch WHERE batchNo = ?)", [batch])[0].q);
const order = (qty: number, extra: Record<string, unknown> = {}) => placeOrder(db, { branchId: G, customerId: chem, userId: U, idempotencyKey: key(), lines: [{ medicineId: med, qty }], ...extra }, today);

beforeEach(async () => {
  db = await memoryDb("DIST2");
  db.setMeta("pharmacy", JSON.stringify({ gstin: "27AAKFS3192P1Z6" }));
  // Strips of 10, PTR ₹50, GST 12%. 20 strips expiring first, 100 later.
  med = addMedicine(db, { name: "Amoxyclav 625", gstRate: 12, mrpPaise: 8000, packSize: 10 }).id;
  receiveStock(db, { branchId: G, medicineId: med, batchNo: "EARLY", expiryDate: addDays(today, 200), qty: 10 * 20, costPaise: 4000, mrpPaise: 8000, userId: U });
  receiveStock(db, { branchId: G, medicineId: med, batchNo: "LATE", expiryDate: addDays(today, 400), qty: 10 * 100, costPaise: 4000, mrpPaise: 8000, userId: U });
  saveProduct(db, { medicineId: med, ptrPaise: 5000 });
  chem = addCustomer(db, { name: "Sai Medical", phone: "9822000222", creditLimitPaise: 100_000_00 }).id;
  saveChemist(db, { customerId: chem, stateCode: "27", dl20b: "MH-PZ-20B-123", dlExpiry: addDays(today, 300) });
});

describe("distribution orders on the device", () => {
  it("place → approve (reserves FEFO) → pick → pack → invoice, and reserved stock isn't free for a counter bill", () => {
    const o = order(25);
    expect(o).toMatchObject({ status: "pending", creditOk: true });
    expect(o.no).toMatch(/^SO-W/);
    expect(approveOrder(db, { orderId: o.orderId, userId: U }, today)).toMatchObject({ cut: [], pickLines: 2 });
    expect(statusOf(db, o.orderId)).toBe("approved");
    // 20 strips of the early batch and 5 of the later one are now promised to this order.
    const picks = pickList(db, o.orderId);
    expect(picks.map((p) => [p.batchNo, p.units])).toEqual([["EARLY", 200], ["LATE", 50]]);
    expect(Object.values(reservedUnits(db)).reduce((a, b) => a + b, 0)).toBe(250);
    // A counter bill now can't take the reserved strips: 120 in stock, 25 promised.
    expect(() => directInvoice(db, { branchId: G, customerId: chem, userId: U, idempotencyKey: key(), lines: [{ medicineId: med, qty: 96 }] }, today)).toThrow(/only 95 packs available/);
    // The approved order counts in the chemist's exposure.
    expect(creditFor(db, chem, 0, today).exposure).toBe(140000);

    startPicking(db, { orderId: o.orderId, userId: U });
    expect(statusOf(db, o.orderId)).toBe("picking");
    expect(() => packOrder(db, { orderId: o.orderId, boxes: 1, userId: U })).toThrow(/2 line\(s\) not picked yet/);
    for (const p of picks) confirmPickLine(db, { pickLineId: p.id, pickedUnits: p.units, userId: U });
    packOrder(db, { orderId: o.orderId, boxes: 2, userId: U });
    expect(statusOf(db, o.orderId)).toBe("packed");
    const inv = invoiceOrder(db, { orderId: o.orderId, userId: U }, today);
    expect(inv.total).toBe(140000); // 25 × ₹50 = ₹1,250 + 12% = ₹1,400
    expect(statusOf(db, o.orderId)).toBe("invoiced");
    expect(invoiceView(db, inv.invoiceId)!.orderId).toBe(o.orderId);
    expect(stockUnits("EARLY")).toBe(0);
    expect(stockUnits("LATE")).toBe(950);
    expect(reservedUnits(db)).toEqual({}); // invoiced: nothing promised any more
    expect(customerBalance(db, chem)).toBe(140000);
    expect(() => invoiceOrder(db, { orderId: o.orderId, userId: U }, today)).toThrow(/can’t be moved/);
    // Cancelling that invoice cancels the order and returns the stock.
    cancelInvoice(db, { invoiceId: inv.invoiceId, reason: "Wrong godown", userId: U }, today);
    expect(statusOf(db, o.orderId)).toBe("cancelled");
    expect(stockUnits("EARLY")).toBe(200);
  });

  it("a credit hold is booked, then approved only by a manager with a reason", () => {
    db.engine.run("UPDATE customer SET creditLimitPaise = 50000 WHERE id = ?", [chem]); // ₹500
    const o = order(25);
    expect(o).toMatchObject({ creditOk: false, reasons: [expect.stringMatching(/Credit limit exceeded/)] });
    expect(() => approveOrder(db, { orderId: o.orderId, userId: U }, today)).toThrow(/Ask a manager/);
    expect(() => approveOrder(db, { orderId: o.orderId, userId: U, canOverride: true }, today)).toThrow(/Enter a reason/);
    approveOrder(db, { orderId: o.orderId, userId: U, canOverride: true, overrideReason: "Regular payer, cleared by owner" }, today);
    expect(db.engine.all<{ overrideReason: string }>("SELECT overrideReason FROM distOrderEvent WHERE kind = 'approved'")[0].overrideReason).toMatch(/Regular payer/);
    // A blocked chemist's order isn't even accepted.
    saveChemist(db, { customerId: chem, stateCode: "27", dlExpiry: addDays(today, -1) });
    expect(() => order(1)).toThrow(/Order can’t be accepted: Drug licence expired/);
  });

  it("short stock: refused, or cut to what's there with free goods kept in proportion", () => {
    saveScheme(db, { code: "AMX10", name: "10+1", kind: "free", medicineId: med, buyQty: 10, freeQty: 1, validFrom: today, validTo: addDays(today, 30) });
    const o = order(110); // 110 + 11 free = 121 packs; 120 in stock
    expect(() => approveOrder(db, { orderId: o.orderId, userId: U }, today)).toThrow(/only 120 available, ordered 121/);
    expect(approveOrder(db, { orderId: o.orderId, userId: U, allowPartial: true }, today).cut).toEqual(["Amoxyclav 625 120/121"]);
    const picks = pickList(db, o.orderId);
    expect(picks.reduce((a, p) => a + p.units, 0)).toBe(1200);
    expect(picks.reduce((a, p) => a + p.paidUnits, 0)).toBe(1100); // 110 paid + 10 free
  });

  it("a short pick is invoiced as picked (free goods come off first) and the rest stays in stock", () => {
    saveScheme(db, { code: "AMX10", name: "10+1", kind: "free", medicineId: med, buyQty: 10, freeQty: 1, validFrom: today, validTo: addDays(today, 30) });
    const o = order(10); // 10 + 1 free, all from the early batch
    approveOrder(db, { orderId: o.orderId, userId: U }, today);
    const [p] = pickList(db, o.orderId);
    expect(p.units).toBe(110);
    confirmPickLine(db, { pickLineId: p.id, pickedUnits: 100, userId: U }); // one strip damaged on the rack
    expect(() => confirmPickLine(db, { pickLineId: p.id, pickedUnits: 100, userId: U })).toThrow(/already picked/);
    packOrder(db, { orderId: o.orderId, boxes: 1, userId: U });
    const v = invoiceView(db, invoiceOrder(db, { orderId: o.orderId, userId: U }, today).invoiceId)!;
    expect(v.lines.map((l) => [Number(l.qty), Number(l.freeQty)])).toEqual([[10, 0]]);
    expect(stockUnits("EARLY")).toBe(100);
  });

  it("reject and cancel follow the order rules, and a cancelled order frees its stock", () => {
    const a = order(5);
    expect(() => rejectOrder(db, { orderId: a.orderId, reason: "", userId: U })).toThrow(/reason/);
    rejectOrder(db, { orderId: a.orderId, reason: "Duplicate order", userId: U });
    expect(statusOf(db, a.orderId)).toBe("rejected");
    expect(() => approveOrder(db, { orderId: a.orderId, userId: U }, today)).toThrow(/can’t be moved/);
    const b = order(30);
    approveOrder(db, { orderId: b.orderId, userId: U }, today);
    expect(Object.values(reservedUnits(db)).reduce((x, y) => x + y, 0)).toBe(300);
    cancelOrder(db, { orderId: b.orderId, reason: "Chemist called off", userId: U });
    expect(reservedUnits(db)).toEqual({});
    expect(listOrders(db, { open: true })).toEqual([]);
    expect(listOrders(db).map((o) => o.status).sort()).toEqual(["cancelled", "rejected"]);
    // A retried order with the same key is the same order.
    const k = key();
    const c = placeOrder(db, { branchId: G, customerId: chem, userId: U, idempotencyKey: k, lines: [{ medicineId: med, qty: 1 }] }, today);
    expect(placeOrder(db, { branchId: G, customerId: chem, userId: U, idempotencyKey: k, lines: [{ medicineId: med, qty: 1 }] }, today)).toMatchObject({ orderId: c.orderId, replayed: true });
  });

  it("a salesman books only for their own chemists", () => {
    saveChemist(db, { customerId: chem, stateCode: "27", dlExpiry: addDays(today, 300), salesmanId: "sm-1" });
    expect(() => order(1, { salesmanId: "sm-2", canApprove: false })).toThrow(/isn’t assigned to you/);
    expect(order(1, { salesmanId: "sm-1", canApprove: false, source: "salesman" }).status).toBe("pending");
  });
});
