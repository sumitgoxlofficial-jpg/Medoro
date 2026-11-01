import { describe, expect, it, beforeEach } from "vitest";
import { memoryDb } from "./node";
import type { DriveDB } from "./client";
import { addMedicine, createSale, receiveStock, stockOf, CounterError } from "./pharmacy";
import { addCustomer, addSupplier, createReturn, customerBalance, findCustomers, receivePayment, recordPurchase, returnedQty } from "./trade";
import { TABLES } from "./schema";

const B = "branch-main", U = "user-1", TODAY = "2026-11-01";
let db: DriveDB;
beforeEach(async () => { db = await memoryDb("C1"); });

const med = (over: Parameters<typeof addMedicine>[1] = { name: "Dolo 650", gstRate: 12, mrpPaise: 3200 }) => addMedicine(db, over);
const sell = (lines: { medicineId: string; qty: number; unit?: "pack" | "loose" }[], extra: Record<string, unknown> = {}) =>
  createSale(db, { branchId: B, series: "C1", userId: U, lines, pay: { mode: "cash" }, ...extra }, TODAY);

it("migration 2 creates exactly the tables and columns the SDK allows", () => {
  for (const t of ["supplier", "purchase", "purchaseItem", "salesReturn", "salesReturnItem", "customerReceipt"] as const) {
    const cols = db.engine.all<{ name: string }>(`PRAGMA table_info(${t})`).map((r) => r.name);
    expect(cols.sort()).toEqual([...TABLES[t].columns].sort());
  }
  expect(() => db.engine.run("DELETE FROM salesReturn")).not.toThrow(); // empty table: trigger only fires per row
});

describe("customers", () => {
  it("adds, finds by phone or name, and refuses a duplicate phone or bad GSTIN", () => {
    addCustomer(db, { name: "Asha Kumari", phone: "9822000001" });
    addCustomer(db, { name: "Ravi", phone: "9822000002" });
    expect(findCustomers(db, "98220000").map((c) => c.name)).toEqual(["Asha Kumari", "Ravi"]);
    expect(findCustomers(db, "asha").map((c) => c.phone)).toEqual(["9822000001"]);
    expect(() => addCustomer(db, { name: "Other", phone: "9822000001" })).toThrow(/already saved/);
    expect(() => addCustomer(db, { name: "Firm", gstin: "22AAAAA0000A1Z0" })).toThrow(/GSTIN/);
    expect(() => addCustomer(db, { name: "X", phone: "12345" })).toThrow(/10-digit/);
  });

  it("tracks credit: bills add, payments and credited returns reduce, limit applies to the balance", () => {
    const m = med();
    receiveStock(db, { branchId: B, medicineId: m.id, batchNo: "A", expiryDate: "2027-12-31", qty: 100, costPaise: 2000, mrpPaise: 3200, userId: U });
    const c = addCustomer(db, { name: "Asha", phone: "9822000001", creditLimitPaise: 10000 });
    const s1 = sell([{ medicineId: m.id, qty: 3 }], { customerId: c.id, pay: { mode: "credit" } }); // ₹96
    expect(customerBalance(db, c.id)).toBe(9600);
    expect(() => sell([{ medicineId: m.id, qty: 1 }], { customerId: c.id, pay: { mode: "credit" } })).toThrow(/credit limit/);
    expect(() => receivePayment(db, { customerId: c.id, amountPaise: 20000, mode: "cash", userId: U })).toThrow(/owes only/);
    expect(receivePayment(db, { customerId: c.id, amountPaise: 5000, mode: "upi", userId: U }).balancePaise).toBe(4600);
    const item = db.from("saleItem").eq("saleId", s1.saleId).first()!;
    createReturn(db, { saleId: s1.saleId, series: "C1", userId: U, reason: "Not needed", condition: "sealed", refundMode: "credit", lines: [{ saleItemId: String(item.id), qty: 1 }] }, TODAY);
    expect(customerBalance(db, c.id)).toBe(4600 - 3200);
    // Room under the limit again.
    expect(sell([{ medicineId: m.id, qty: 1 }], { customerId: c.id, pay: { mode: "credit" } }).invoiceNo).toBeTruthy();
  });
});

describe("purchases", () => {
  it("adds paid and free packs to stock in stock units, with GST on the paid packs", () => {
    const strip = med({ name: "Azee 500", gstRate: 12, mrpPaise: 11900, packSize: 3, packUnit: "strip", looseUnit: "tab", allowLoose: true });
    const sup = addSupplier(db, { name: "Bokaro Pharma", gstin: "27AAPFU0939F1ZV" });
    const r = recordPurchase(db, { branchId: B, supplierId: sup.id, billNo: "BP/101", billDate: TODAY, userId: U,
      lines: [{ medicineId: strip.id, batchNo: "AZ1", expiryDate: "2028-01-31", packs: 10, freePacks: 2, costPaise: 8000, mrpPaise: 11900 }] }, TODAY);
    expect(r).toMatchObject({ taxablePaise: 80000, taxPaise: 9600, totalPaise: 89600 });
    expect(stockOf(db, strip.id, B, TODAY)).toBe(12 * 3);
    expect(db.from("purchaseItem").eq("purchaseId", r.purchaseId).first()).toMatchObject({ packs: 10, freePacks: 2 });
    expect(db.from("stockMovement").eq("refId", r.purchaseId).first()).toMatchObject({ type: "grn", qty: 36 });
  });

  it("refuses a repeated bill, expired stock, rate above MRP, future date — and keeps nothing from a bad bill", () => {
    const m = med();
    const sup = addSupplier(db, { name: "S" });
    const line = { medicineId: m.id, batchNo: "A", expiryDate: "2028-01-31", packs: 5, costPaise: 2000, mrpPaise: 3200 };
    recordPurchase(db, { branchId: B, supplierId: sup.id, billNo: "1", billDate: TODAY, userId: U, lines: [line] }, TODAY);
    expect(() => recordPurchase(db, { branchId: B, supplierId: sup.id, billNo: "1", billDate: TODAY, userId: U, lines: [line] }, TODAY)).toThrow(/already entered/);
    expect(() => recordPurchase(db, { branchId: B, supplierId: sup.id, billNo: "2", billDate: TODAY, userId: U, lines: [{ ...line, batchNo: "OLD", expiryDate: "2026-10-01" }] }, TODAY)).toThrow(/expired/);
    expect(() => recordPurchase(db, { branchId: B, supplierId: sup.id, billNo: "3", billDate: TODAY, userId: U, lines: [line, { ...line, batchNo: "B", costPaise: 4000 }] }, TODAY)).toThrow(/more than the MRP/);
    expect(() => recordPurchase(db, { branchId: B, supplierId: sup.id, billNo: "4", billDate: "2026-12-01", userId: U, lines: [line] }, TODAY)).toThrow(/future/);
    expect(stockOf(db, m.id, B, TODAY)).toBe(5); // the bad bill #3 added nothing, not even its good first line
    expect(db.from("purchase").count()).toBe(1);
  });
});

describe("sales returns", () => {
  it("refunds the share paid after discount, restocks sealed goods and numbers credit notes per counter", () => {
    const m = med();
    receiveStock(db, { branchId: B, medicineId: m.id, batchNo: "A", expiryDate: "2027-12-31", qty: 10, costPaise: 2000, mrpPaise: 3200, userId: U });
    const s = sell([{ medicineId: m.id, qty: 3 }], { discountPct: 10 }); // 9600 − 960 = 8640 net
    const item = String(db.from("saleItem").eq("saleId", s.saleId).first()!.id);
    const a = createReturn(db, { saleId: s.saleId, series: "C1", userId: U, reason: "Wrong item", condition: "sealed", refundMode: "cash", lines: [{ saleItemId: item, qty: 1 }] }, TODAY);
    const b = createReturn(db, { saleId: s.saleId, series: "C1", userId: U, reason: "Wrong item", condition: "opened", refundMode: "cash", lines: [{ saleItemId: item, qty: 2 }] }, TODAY);
    expect([a.creditNoteNo, b.creditNoteNo]).toEqual(["CNC12627-0001", "CNC12627-0002"]);
    expect(a.amountPaise + b.amountPaise).toBe(8640); // partial returns add up exactly
    expect([a.restocked, b.restocked]).toEqual([1, 0]); // opened pack isn't put back
    expect(stockOf(db, m.id, B, TODAY)).toBe(10 - 3 + 1);
    expect(returnedQty(db, item)).toBe(3);
    expect(() => createReturn(db, { saleId: s.saleId, series: "C1", userId: U, reason: "x", condition: "sealed", refundMode: "cash", lines: [{ saleItemId: item, qty: 1 }] }, TODAY)).toThrow(/Only 0/);
  });

  it("returns loose units in units, refuses credit refunds without a customer and lines from other bills", () => {
    const strip = med({ name: "Azee 500", gstRate: 12, mrpPaise: 11900, packSize: 3, packUnit: "strip", looseUnit: "tab", allowLoose: true });
    receiveStock(db, { branchId: B, medicineId: strip.id, batchNo: "S1", expiryDate: "2027-12-31", qty: 9, costPaise: 8000, mrpPaise: 11900, userId: U });
    const s1 = sell([{ medicineId: strip.id, qty: 2, unit: "loose" }]);
    const s2 = sell([{ medicineId: strip.id, qty: 1 }]);
    const it1 = String(db.from("saleItem").eq("saleId", s1.saleId).first()!.id), it2 = String(db.from("saleItem").eq("saleId", s2.saleId).first()!.id);
    expect(() => createReturn(db, { saleId: s1.saleId, series: "C1", userId: U, reason: "x", condition: "sealed", refundMode: "credit", lines: [{ saleItemId: it1, qty: 1 }] }, TODAY)).toThrow(/bill with a customer/);
    expect(() => createReturn(db, { saleId: s1.saleId, series: "C1", userId: U, reason: "x", condition: "sealed", refundMode: "cash", lines: [{ saleItemId: it2, qty: 1 }] }, TODAY)).toThrow(CounterError);
    createReturn(db, { saleId: s1.saleId, series: "C1", userId: U, reason: "x", condition: "sealed", refundMode: "cash", lines: [{ saleItemId: it1, qty: 2 }] }, TODAY);
    expect(stockOf(db, strip.id, B, TODAY)).toBe(9 - 2 - 3 + 2);
  });

  it("doesn't restock an expired batch even if sealed", () => {
    const m = med();
    const bId = receiveStock(db, { branchId: B, medicineId: m.id, batchNo: "A", expiryDate: "2026-11-15", qty: 5, costPaise: 2000, mrpPaise: 3200, userId: U });
    const s = sell([{ medicineId: m.id, qty: 1 }]);
    const item = String(db.from("saleItem").eq("saleId", s.saleId).first()!.id);
    const r = createReturn(db, { saleId: s.saleId, series: "C1", userId: U, reason: "x", condition: "sealed", refundMode: "cash", lines: [{ saleItemId: item, qty: 1 }] }, "2026-11-20");
    expect(r.restocked).toBe(0);
    expect(db.from("stockMovement").eq("batchId", bId).count()).toBe(2);
  });
});
