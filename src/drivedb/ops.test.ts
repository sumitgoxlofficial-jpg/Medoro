import { beforeEach, describe, expect, it } from "vitest";
import { memoryDb } from "./node";
import type { DriveDB } from "./client";
import { addMedicine, createSale, pointsBalance, receiveStock, stockOf } from "./pharmacy";
import { addCustomer, createReturn, customerBalance } from "./trade";
import { dayReport } from "./reports";
import { adjustStock, cancelOrder, createOrder, deliverOrder, dispatchOrder, listOrders, packOrder, recordCount, setBatchStatus } from "./ops";
import { todayISO } from "@/lib/dates";
import { SCHEMA_VERSION, TABLES } from "./schema";

const B = "b1", U = "u1";
let db: DriveDB;
beforeEach(async () => { db = await memoryDb("C1"); });

const setup = (qty = 20) => {
  const m = addMedicine(db, { name: "Dolo 650", gstRate: 12, mrpPaise: 10000 });
  const batch = receiveStock(db, { branchId: B, medicineId: m.id, batchNo: "A", expiryDate: "2030-01-31", qty, costPaise: 6000, mrpPaise: 10000, userId: U });
  return { m, batch };
};

it("migration 5 matches the SDK's tables", () => {
  for (const t of ["loyaltyLedger", "deliveryOrder", "deliveryOrderItem", "salesReturn"] as const) {
    expect(db.engine.all<{ name: string }>(`PRAGMA table_info(${t})`).map((r) => r.name).sort()).toEqual([...TABLES[t].columns].sort());
  }
  expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(5);
});

describe("stock corrections", () => {
  it("writes off and finds stock, refuses taking out more than there is, and a count fixes differences", () => {
    const { m, batch } = setup(20);
    expect(adjustStock(db, { branchId: B, batchId: batch, userId: U, qty: -3, reason: "damaged" }).qtyAvailable).toBe(17);
    expect(() => adjustStock(db, { branchId: B, batchId: batch, userId: U, qty: -50, reason: "lost" })).toThrow(/Only 17/);
    expect(() => adjustStock(db, { branchId: B, batchId: batch, userId: U, qty: 2, reason: "damaged" })).toThrow(/negative/);
    adjustStock(db, { branchId: B, batchId: batch, userId: U, qty: 1, reason: "found" });
    const r = recordCount(db, { branchId: B, userId: U, counts: [{ batchId: batch, counted: 15 }] });
    expect(r.diffs[0]).toMatchObject({ system: 18, counted: 15, diff: -3 });
    expect(stockOf(db, m.id, B)).toBe(15);
  });

  it("a quarantined or recalled batch can't be sold until released", () => {
    const { m, batch } = setup(5);
    setBatchStatus(db, batch, "recalled");
    expect(() => createSale(db, { branchId: B, series: "C1", userId: U, lines: [{ medicineId: m.id, qty: 1 }], pay: { mode: "cash" } })).toThrow(/Not enough/);
    setBatchStatus(db, batch, "ok");
    expect(createSale(db, { branchId: B, series: "C1", userId: U, lines: [{ medicineId: m.id, qty: 1 }], pay: { mode: "cash" } }).invoiceNo).toBeTruthy();
  });
});

describe("loyalty", () => {
  beforeEach(() => db.setMeta("loyalty", JSON.stringify({ enabled: true, earnPer100: 2, pointValuePaise: 100, minRedeem: 10 })));

  it("earns on what is paid, spends points as part payment, and returns give points back in proportion", () => {
    const { m } = setup(20);
    const c = addCustomer(db, { name: "Asha", phone: "9822000001" });
    const first = createSale(db, { branchId: B, series: "C1", userId: U, customerId: c.id, lines: [{ medicineId: m.id, qty: 5 }], pay: { mode: "cash" } }); // ₹500 → 10 points
    expect(first.pointsEarned).toBe(10);
    expect(() => createSale(db, { branchId: B, series: "C1", userId: U, customerId: c.id, lines: [{ medicineId: m.id, qty: 1 }], pay: { mode: "cash" }, redeemPoints: 5 })).toThrow(/at least 10/);
    expect(() => createSale(db, { branchId: B, series: "C1", userId: U, customerId: c.id, lines: [{ medicineId: m.id, qty: 1 }], pay: { mode: "cash" }, redeemPoints: 50 })).toThrow(/only 10 points/);
    const second = createSale(db, { branchId: B, series: "C1", userId: U, customerId: c.id, lines: [{ medicineId: m.id, qty: 2 }], pay: { mode: "cash" }, redeemPoints: 10 }); // ₹200, ₹10 in points
    expect(second).toMatchObject({ totalPaise: 20000, duePaise: 19000, pointsEarned: 3 });
    expect(db.from("payment").eq("saleId", second.saleId).first()).toMatchObject({ amountPaise: 19000 });
    expect(pointsBalance(db, c.id)).toBe(3);
    // Return half the second bill: ₹100 credit note = ₹95 cash + 5 points back; 1 earned point taken back.
    const item = String(db.from("saleItem").eq("saleId", second.saleId).first()!.id);
    const r = createReturn(db, { saleId: second.saleId, series: "C1", userId: U, reason: "x", condition: "sealed", refundMode: "cash", lines: [{ saleItemId: item, qty: 1 }] });
    expect(r).toMatchObject({ amountPaise: 10000, refundPaise: 9500, pointsBack: 5 });
    expect(pointsBalance(db, c.id)).toBe(3 + 5 - 1);
    expect(dayReport(db, B, todayISO()).returns.cash).toBe(9500);
  });
});

describe("delivery orders", () => {
  it("takes an order, bills it at packing, and on cash-on-delivery the rider's cash settles the bill", () => {
    const { m } = setup(10);
    const c = addCustomer(db, { name: "Ravi", phone: "9822000002" }); // no credit limit: COD still allowed
    const o = createOrder(db, { branchId: B, series: "C1", customerId: c.id, address: "12 Sector 4, Bokaro", payment: "cod", items: [{ medicineId: m.id, qty: 3 }] });
    expect(o.orderNo).toBe("C1-O1");
    expect(stockOf(db, m.id, B)).toBe(10); // not taken until packed
    expect(() => dispatchOrder(db, o.id, "Raju")).toThrow(/Pack and bill/);
    const sale = packOrder(db, { orderId: o.id, userId: U, series: "C1" });
    expect(stockOf(db, m.id, B)).toBe(7);
    expect(customerBalance(db, c.id)).toBe(sale.totalPaise);
    expect(() => cancelOrder(db, o.id)).toThrow(/return from its bill/);
    dispatchOrder(db, o.id, "Raju");
    deliverOrder(db, o.id, U);
    expect(customerBalance(db, c.id)).toBe(0);
    expect(dayReport(db, B, todayISO()).receipts.cash).toBe(sale.totalPaise);
    expect(listOrders(db, B)).toEqual([]);
    expect(listOrders(db, B, true)[0]).toMatchObject({ status: "delivered", rider: "Raju", invoiceNo: sale.invoiceNo, items: [{ name: "Dolo 650", qty: 3, unit: "pack" }] });
  });

  it("prepaid orders are billed as paid; an unbilled order can be cancelled", () => {
    const { m } = setup(10);
    const c = addCustomer(db, { name: "Mina", phone: "9822000003" });
    const o = createOrder(db, { branchId: B, series: "C1", customerId: c.id, address: "Flat 2, City Centre", payment: "upi", items: [{ medicineId: m.id, qty: 1 }] });
    const sale = packOrder(db, { orderId: o.id, userId: U, series: "C1" });
    expect(db.from("payment").eq("saleId", sale.saleId).first()).toMatchObject({ mode: "upi" });
    const o2 = createOrder(db, { branchId: B, series: "C1", customerId: c.id, address: "Flat 2, City Centre", payment: "cash", items: [{ medicineId: m.id, qty: 1 }] });
    cancelOrder(db, o2.id);
    expect(() => packOrder(db, { orderId: o2.id, userId: U, series: "C1" })).toThrow(/already cancelled/);
  });
});

it("migration 6 adds inter-state tax to bills", () => {
  expect(db.engine.all<{ name: string }>("PRAGMA table_info(sale)").map((r) => r.name).sort()).toEqual([...TABLES.sale.columns].sort());
  expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(6);
});

it("migration 7 adds e-invoices and buyers' addresses", () => {
  for (const t of ["customer", "einvoice"] as const) expect(db.engine.all<{ name: string }>(`PRAGMA table_info(${t})`).map((r) => r.name).sort()).toEqual([...TABLES[t].columns].sort());
  expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(7);
});
