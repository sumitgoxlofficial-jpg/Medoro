import { beforeEach, describe, expect, it } from "vitest";
import { memoryDb } from "./node";
import type { DriveDB } from "./client";
import { addMedicine, createSale } from "./pharmacy";
import { addCustomer, addSupplier, recordPurchase } from "./trade";
import { addExpense } from "./books";
import { dashboard } from "./dashboard";
import { addDays, todayISO } from "@/lib/dates";

const B = "b1", U = "u1";
let db: DriveDB;
beforeEach(async () => { db = await memoryDb("C1"); });

describe("device dashboard", () => {
  it("sums sales, margin, purchases, expenses and dues, and lists low and expiring stock", () => {
    const today = todayISO();
    const m = addMedicine(db, { name: "Dolo 650", gstRate: 12, mrpPaise: 3200, reorderLevel: 30 });
    const quiet = addMedicine(db, { name: "Pan 40", gstRate: 12, mrpPaise: 15500, reorderLevel: 0 });
    const sup = addSupplier(db, { name: "Agency" });
    recordPurchase(db, { branchId: B, supplierId: sup.id, billNo: "P1", billDate: today, userId: U, lines: [
      { medicineId: m.id, batchNo: "A", expiryDate: addDays(today, 40), packs: 20, costPaise: 2000, mrpPaise: 3200 },
      { medicineId: quiet.id, batchNo: "Q", expiryDate: "2031-01-31", packs: 5, costPaise: 10000, mrpPaise: 15500 },
    ] });
    const c = addCustomer(db, { name: "Asha", phone: "9822000001", creditLimitPaise: 100000 });
    createSale(db, { branchId: B, series: "C1", userId: U, lines: [{ medicineId: m.id, qty: 2 }], pay: { mode: "cash" } });
    createSale(db, { branchId: B, series: "C1", userId: U, customerId: c.id, lines: [{ medicineId: m.id, qty: 3 }], pay: { mode: "credit" } });
    addExpense(db, { branchId: B, category: "Rent", amountPaise: 50000, mode: "cash", userId: U });

    const d = dashboard(db, B, "today", today);
    expect(d.sales).toEqual({ paise: 16000, bills: 2 });
    expect(d.margin.pct).toBeGreaterThan(0);
    expect(d.purchases).toEqual({ paise: 100800, count: 1 }); // (20 × ₹20 + 5 × ₹100) + 12% GST
    expect(d.expenses).toEqual({ paise: 50000, count: 1 });
    expect(d.receivables).toEqual({ paise: 9600, customers: 1 });
    expect(d.payables).toEqual({ paise: d.purchases.paise, suppliers: 1 });
    expect(d.collections).toMatchObject({ cash: 6400, credit: 9600 });
    expect(d.chart).toHaveLength(14);
    expect(d.chart.at(-1)).toEqual({ date: today, salesPaise: 16000 });
    expect(d.lowStock.map((x) => x.name)).toEqual(["Dolo 650"]); // 15 left, reorder at 30; Pan 40 has no reorder level
    expect(d.expiring.map((x) => x.name)).toEqual(["Dolo 650"]);
    expect(d.expiringCount).toBe(1);
    expect(d.expiring[0].daysLeft).toBe(40);
    // 5 strips sold today over a 28-day window: 15 left lasts 84 days.
    expect(d.lowStock[0]).toMatchObject({ stock: 15, reorder: 30, daysCover: 84 });
    expect(d.branches).toEqual([{ id: B, name: "This branch", salesPaise: 16000, bills: 2 }]);
    expect(d.activity.map((r) => r.kind)).toEqual(expect.arrayContaining(["bill", "purchase", "expense"]));
    // Yesterday's range is empty.
    expect(dashboard(db, B, "today", addDays(today, 1)).sales).toEqual({ paise: 0, bills: 0 });
    expect(dashboard(db, B, "7d", addDays(today, 1)).sales.bills).toBe(2);
  });
});
