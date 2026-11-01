import { beforeEach, describe, expect, it } from "vitest";
import { memoryDb } from "./node";
import type { DriveDB } from "./client";
import { addMedicine, createSale, receiveStock } from "./pharmacy";
import { addCustomer, addSupplier, createReturn, receivePayment, recordPurchase } from "./trade";
import { customerList, dayReport, listBills, saleDetail, stockList, supplierList, updateMedicine } from "./reports";
import { checkPin, counterConfig, importSeed, setPin } from "./seed";
import { todayISO } from "@/lib/dates";

const B = "b1", U = "u1";
let db: DriveDB;
beforeEach(async () => { db = await memoryDb("C1"); });

describe("device reports", () => {
  it("day-end summary: takings by mode, refunds, cash in hand and purchases", () => {
    const today = todayISO();
    const m = addMedicine(db, { name: "Dolo 650", gstRate: 12, mrpPaise: 3200, reorderLevel: 2 });
    const sup = addSupplier(db, { name: "Agency" });
    recordPurchase(db, { branchId: B, supplierId: sup.id, billNo: "P1", billDate: today, userId: U, lines: [{ medicineId: m.id, batchNo: "A", expiryDate: "2030-01-31", packs: 20, costPaise: 2000, mrpPaise: 3200 }] });
    const c = addCustomer(db, { name: "Asha", phone: "9822000001", creditLimitPaise: 100000 });
    const cash = createSale(db, { branchId: B, series: "C1", userId: U, lines: [{ medicineId: m.id, qty: 2 }], pay: { mode: "cash" } });
    createSale(db, { branchId: B, series: "C1", userId: U, lines: [{ medicineId: m.id, qty: 1 }], pay: { mode: "upi" } });
    createSale(db, { branchId: B, series: "C1", userId: U, customerId: c.id, lines: [{ medicineId: m.id, qty: 3 }], pay: { mode: "credit" } });
    receivePayment(db, { customerId: c.id, amountPaise: 5000, mode: "cash", userId: U });
    const item = String(db.from("saleItem").eq("saleId", cash.saleId).first()!.id);
    createReturn(db, { saleId: cash.saleId, series: "C1", userId: U, reason: "x", condition: "sealed", refundMode: "cash", lines: [{ saleItemId: item, qty: 1 }] });

    const r = dayReport(db, B, today);
    expect(r.bills).toBe(3);
    expect(r.byMode).toEqual({ cash: 6400, upi: 3200, card: 0, credit: 9600 });
    expect(r.returns).toMatchObject({ count: 1, cash: 3200 });
    expect(r.receipts.cash).toBe(5000);
    expect(r.cashInHandPaise).toBe(6400 + 5000 - 3200);
    expect(r.purchases).toEqual({ count: 1, totalPaise: 44800 });

    const bills = listBills(db, today);
    expect(bills).toHaveLength(3);
    expect(listBills(db, today, "asha")).toHaveLength(1);
    expect(listBills(db, today, cash.invoiceNo)[0].returned).toBe(3200);

    const d = saleDetail(db, cash.saleId);
    expect(d.lines[0]).toMatchObject({ name: "Dolo 650", batchNo: "A", qty: 2, returned: 1, hsn: "3004" });
    expect(d.payments[0]).toMatchObject({ mode: "cash", amountPaise: 6400 });
    expect(d.returns[0].creditNoteNo).toMatch(/^CNC1/);

    expect(customerList(db)[0]).toMatchObject({ name: "Asha", balancePaise: 9600 - 5000 });
    expect(supplierList(db).map((s) => s.name)).toEqual(["Agency"]);
    expect(stockList(db, B)[0]).toMatchObject({ stock: 20 - 2 - 1 - 3 + 1, nextExpiry: "2030-01-31", low: false });
  });

  it("edits a medicine and flags low stock", () => {
    const m = addMedicine(db, { name: "Pan 40", gstRate: 12, mrpPaise: 15500, barcode: "111" });
    addMedicine(db, { name: "Other", gstRate: 12, mrpPaise: 100, barcode: "222" });
    receiveStock(db, { branchId: B, medicineId: m.id, batchNo: "A", expiryDate: "2030-01-31", qty: 3, costPaise: 9000, mrpPaise: 15500, userId: U });
    expect(updateMedicine(db, m.id, { mrpPaise: 16000, reorderLevel: 5, rack: "A1" })).toMatchObject({ mrpPaise: 16000, rack: "A1" });
    expect(stockList(db, B, "pan")[0].low).toBe(true);
    expect(() => updateMedicine(db, m.id, { barcode: "222" })).toThrow(/already on another/);
    expect(() => updateMedicine(db, m.id, { gstRate: 7 as never })).toThrow();
  });
});

describe("counter PIN", () => {
  it("checks the PIN, never stores it, and locks for 5 minutes after 5 wrong tries", async () => {
    await expect(checkPin(db, "1234")).rejects.toThrow(/No counter PIN/);
    await expect(setPin(db, "12")).rejects.toThrow(/4 to 8 digits/);
    await setPin(db, "4826");
    expect(db.getMeta("pinHash")).not.toContain("4826");
    expect(await checkPin(db, "4826")).toBe(true);
    const t = Date.now();
    for (let i = 0; i < 5; i++) expect(await checkPin(db, "0000", t)).toBe(false);
    await expect(checkPin(db, "4826", t + 1000)).rejects.toThrow(/Too many/);
    expect(await checkPin(db, "4826", t + 6 * 60_000)).toBe(true);
  });

  it("the device remembers the pharmacy details and user for printing and offline use", () => {
    const cfg = importSeed(db, { branch: { id: B, code: "MAIN", name: "Main" }, maxDiscountPct: 10, medicines: [], batches: [], customers: [],
      pharmacy: { name: "Shankar Pharmacy", tradeName: "Shankar", gstin: "20AAAAA0000A1Z5", dl: "DL-1", address: "Bokaro", phone: "9800000000" }, userName: "Sumit" }, U);
    expect(cfg).toMatchObject({ userId: U, userName: "Sumit", pinSet: false, pharmacy: { name: "Shankar Pharmacy", address: "Bokaro" } });
    expect(counterConfig(db)?.pharmacy?.gstin).toBe("20AAAAA0000A1Z5");
  });
});
