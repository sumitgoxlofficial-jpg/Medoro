import { beforeEach, describe, expect, it } from "vitest";
import { memoryDb } from "./node";
import type { DriveDB } from "./client";
import { addMedicine, createSale, receiveStock, stockOf } from "./pharmacy";
import { addCustomer, addSupplier, recordPurchase } from "./trade";
import { adjustStock, setBatchStatus, transferStock } from "./ops";
import { activityLog, saleDetail } from "./reports";
import { billText, dueText, waLink } from "./share";
import { importSeed } from "./seed";
import { todayISO } from "@/lib/dates";

const A = "branch-a", Bb = "branch-b";
let db: DriveDB;
beforeEach(async () => {
  db = await memoryDb("C1");
  importSeed(db, { branch: { id: A, code: "MAIN", name: "Main" }, maxDiscountPct: 10, medicines: [], batches: [], customers: [],
    branches: [{ id: A, name: "Main", code: "MAIN" }, { id: Bb, name: "Chas", code: "CHAS" }], users: [{ id: "u-owner", name: "Sumit" }, { id: "u-cash", name: "Ravi" }] }, "u-owner");
});

describe("branch transfers", () => {
  it("moves stock to the other branch under the same batch, and refuses blocked batches or too much", () => {
    const m = addMedicine(db, { name: "Dolo 650", gstRate: 12, mrpPaise: 3200 });
    const b = receiveStock(db, { branchId: A, medicineId: m.id, batchNo: "X1", expiryDate: "2030-01-31", qty: 20, costPaise: 2000, mrpPaise: 3200, userId: "u-owner" });
    expect(() => transferStock(db, { fromBranchId: A, toBranchId: A, batchId: b, qty: 1, userId: "u-owner" })).toThrow(/another branch/);
    expect(() => transferStock(db, { fromBranchId: A, toBranchId: Bb, batchId: b, qty: 50, userId: "u-owner" })).toThrow(/Only 20/);
    const r = transferStock(db, { fromBranchId: A, toBranchId: Bb, batchId: b, qty: 8, userId: "u-owner", note: "for weekend" });
    expect(r.left).toBe(12);
    expect(stockOf(db, m.id, A)).toBe(12);
    expect(stockOf(db, m.id, Bb)).toBe(8);
    transferStock(db, { fromBranchId: A, toBranchId: Bb, batchId: b, qty: 2, userId: "u-owner" });
    expect(db.from("batch").eq("branchId", Bb).count()).toBe(1); // same batch reused there
    setBatchStatus(db, b, "quarantine");
    expect(() => transferStock(db, { fromBranchId: A, toBranchId: Bb, batchId: b, qty: 1, userId: "u-owner" })).toThrow(/blocked/);
  });
});

describe("activity log", () => {
  it("lists who did what, newest first, with names", () => {
    const m = addMedicine(db, { name: "Pan 40", gstRate: 12, mrpPaise: 15500 });
    const s = addSupplier(db, { name: "Agency" });
    recordPurchase(db, { branchId: A, supplierId: s.id, billNo: "P-77", billDate: todayISO(), userId: "u-owner", lines: [{ medicineId: m.id, batchNo: "Q", expiryDate: "2030-01-31", packs: 5, costPaise: 9000, mrpPaise: 15500 }] });
    const batch = String(db.from("batch").first()!.id);
    adjustStock(db, { branchId: A, batchId: batch, userId: "u-cash", qty: -1, reason: "damaged" });
    createSale(db, { branchId: A, series: "C1", userId: "u-cash", lines: [{ medicineId: m.id, qty: 1 }], pay: { mode: "cash" } });
    const log = activityLog(db);
    expect(log.map((r) => r.kind).slice(0, 3)).toEqual(["bill", "adjust", "purchase"]);
    expect(log[0]).toMatchObject({ who: "Ravi", amountPaise: 15500 });
    expect(log[1].what).toMatch(/^Stock corrected: -1 · Pan 40 \(batch Q\) · damaged/);
    expect(log[2]).toMatchObject({ who: "Sumit", what: "Purchase bill P-77 · Agency" });
    expect(activityLog(db, { text: "ravi" })).toHaveLength(2);
  });
});

describe("WhatsApp messages", () => {
  it("builds wa.me links only for valid Indian mobiles, with a bill summary or a due reminder", () => {
    expect(waLink("98220 00001", "hi")).toBe("https://wa.me/919822000001?text=hi");
    expect(waLink("+91 9822000001", "a b")).toBe("https://wa.me/919822000001?text=a%20b");
    expect(waLink("12345", "x")).toBeNull();
    expect(waLink(null, "x")).toBeNull();
    const m = addMedicine(db, { name: "Dolo 650", gstRate: 12, mrpPaise: 3200 });
    receiveStock(db, { branchId: A, medicineId: m.id, batchNo: "X", expiryDate: "2030-01-31", qty: 5, costPaise: 2000, mrpPaise: 3200, userId: "u-owner" });
    const c = addCustomer(db, { name: "Asha", phone: "9822000001" });
    const sale = createSale(db, { branchId: A, series: "C1", userId: "u-owner", customerId: c.id, lines: [{ medicineId: m.id, qty: 2 }], pay: { mode: "cash" } });
    const text = billText(saleDetail(db, sale.saleId), { name: "Shankar Pharmacy", tradeName: "Shankar", gstin: "", dl: "", address: "", phone: "9800000000" });
    expect(text).toContain(`Bill ${sale.invoiceNo}`);
    expect(text).toContain("• Dolo 650 × 2 = ₹64.00");
    expect(text).toContain("Total ₹64.00");
    expect(dueText("Asha", 12050, null)).toContain("₹120.50 is pending");
  });
});
