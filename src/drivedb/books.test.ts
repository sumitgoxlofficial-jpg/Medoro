import { beforeEach, describe, expect, it } from "vitest";
import { memoryDb } from "./node";
import type { DriveDB } from "./client";
import { addMedicine, createSale, receiveStock } from "./pharmacy";
import { addCustomer, addSupplier, createReturn, recordPurchase } from "./trade";
import { dayReport } from "./reports";
import { addExpense, cashBook, expiringStock, gstReturns, paySupplier, salesByDay, supplierDues, supplierLedger, topMedicines } from "./books";
import { todayISO } from "@/lib/dates";
import { cartTotals } from "@/lib/money";

const B = "b1", U = "u1", GSTIN = "27AAPFU0939F1ZV";
let db: DriveDB;
beforeEach(async () => { db = await memoryDb("C1"); });
const today = todayISO(), month = today.slice(0, 7);

describe("suppliers, expenses and cash", () => {
  it("tracks what suppliers are owed, refuses overpaying, and the cash book adds up", () => {
    const m = addMedicine(db, { name: "Dolo 650", gstRate: 12, mrpPaise: 3200 });
    const s = addSupplier(db, { name: "Agency", gstin: GSTIN });
    recordPurchase(db, { branchId: B, supplierId: s.id, billNo: "P1", billDate: today, userId: U, lines: [{ medicineId: m.id, batchNo: "A", expiryDate: "2030-01-31", packs: 10, costPaise: 2000, mrpPaise: 3200 }] });
    expect(supplierDues(db)[0]).toMatchObject({ billed: 22400, paid: 0, duePaise: 22400 });
    expect(() => paySupplier(db, { supplierId: s.id, amountPaise: 30000, mode: "cash", userId: U })).toThrow(/owed only/);
    expect(paySupplier(db, { supplierId: s.id, amountPaise: 10000, mode: "cash", userId: U }).duePaise).toBe(12400);
    expect(supplierLedger(db, s.id).map((r) => r.balancePaise)).toEqual([22400, 12400]);

    createSale(db, { branchId: B, series: "C1", userId: U, lines: [{ medicineId: m.id, qty: 5 }], pay: { mode: "cash" } }); // ₹160
    addExpense(db, { branchId: B, category: "Electricity", amountPaise: 2500, mode: "cash", note: "Oct bill", userId: U });
    expect(() => addExpense(db, { branchId: B, category: "Rent", amountPaise: 1000, mode: "cash", userId: U, date: "2099-01-01" })).toThrow(/future/);
    const cb = cashBook(db, B, today);
    expect(cb).toMatchObject({ inPaise: 16000, outPaise: 10000 + 2500, netPaise: 16000 - 12500 });
    expect(cb.rows.map((r) => r.what)).toEqual(expect.arrayContaining(["Paid Agency", "Electricity · Oct bill"]));
    expect(dayReport(db, B, today)).toMatchObject({ paidOut: { suppliers: 10000, expenses: 2500 }, cashInHandPaise: 3500 });
  });
});

describe("reports", () => {
  it("sales by day with profit, best sellers and expiring stock", () => {
    const a = addMedicine(db, { name: "Pan 40", gstRate: 12, mrpPaise: 11200 });
    const b = addMedicine(db, { name: "Dolo 650", gstRate: 12, mrpPaise: 3200 });
    receiveStock(db, { branchId: B, medicineId: a.id, batchNo: "A1", expiryDate: "2030-01-31", qty: 10, costPaise: 7000, mrpPaise: 11200, userId: U });
    receiveStock(db, { branchId: B, medicineId: b.id, batchNo: "B1", expiryDate: "2027-01-31", qty: 10, costPaise: 2000, mrpPaise: 3200, userId: U });
    createSale(db, { branchId: B, series: "C1", userId: U, lines: [{ medicineId: a.id, qty: 1 }, { medicineId: b.id, qty: 2 }], pay: { mode: "cash" } }, today);
    const t = cartTotals([{ mrpPaise: 11200, qty: 1, gstRate: 12, costPaise: 7000 }, { mrpPaise: 3200, qty: 2, gstRate: 12, costPaise: 2000 }], 0);
    expect(salesByDay(db, B, today, today)[0]).toMatchObject({ bills: 1, salesPaise: t.total, costPaise: 11000, profitPaise: t.total - t.tax - 11000 });
    expect(topMedicines(db, B, today, today).map((r) => r.name)).toEqual(["Pan 40", "Dolo 650"]);
    expect(expiringStock(db, B, 90, "2026-12-01").map((r) => r.batchNo)).toEqual(["B1"]);
    expect(expiringStock(db, B, 30, "2026-12-01")).toEqual([]);
  });
});

describe("GST from the device", () => {
  it("builds GSTR-1, GSTR-3B and HSN from bills, a B2B bill, a credit note and purchases", () => {
    const m = addMedicine(db, { name: "Dolo 650", gstRate: 12, mrpPaise: 11200, hsn: "30049099", form: "Tablet" });
    const v = addMedicine(db, { name: "Vitamin", gstRate: 5, mrpPaise: 10500, form: "Syrup" });
    const sup = addSupplier(db, { name: "Agency", gstin: GSTIN });
    recordPurchase(db, { branchId: B, supplierId: sup.id, billNo: "P1", billDate: today, userId: U, lines: [{ medicineId: m.id, batchNo: "A", expiryDate: "2030-01-31", packs: 10, costPaise: 7000, mrpPaise: 11200 }, { medicineId: v.id, batchNo: "V", expiryDate: "2030-01-31", packs: 10, costPaise: 7000, mrpPaise: 10500 }] });
    const firm = addCustomer(db, { name: "City Clinic", gstin: "29AAGCB7383J1Z4" });
    const walkIn = createSale(db, { branchId: B, series: "C1", userId: U, lines: [{ medicineId: m.id, qty: 1 }, { medicineId: v.id, qty: 1 }], pay: { mode: "cash" } }, today);
    createSale(db, { branchId: B, series: "C1", userId: U, customerId: firm.id, lines: [{ medicineId: m.id, qty: 2 }], pay: { mode: "upi" } }, today);
    const item = String(db.from("saleItem").eq("saleId", walkIn.saleId).eq("medicineId", m.id).first()!.id);
    createReturn(db, { saleId: walkIn.saleId, series: "C1", userId: U, reason: "x", condition: "sealed", refundMode: "cash", lines: [{ saleItemId: item, qty: 1 }] }, today);

    const g = gstReturns(db, month, GSTIN);
    expect(g).toMatchObject({ invoices: 2, creditNotes: 1 });
    expect(g.gstr1.b2b?.[0].ctin).toBe("29AAGCB7383J1Z4");
    expect(g.gstr1.b2cs?.map((r) => r.rt).sort()).toEqual([12, 5].sort());
    expect(g.gstr1.cdnur ?? g.gstr1.b2cs).toBeTruthy();
    const out = g.gstr3b.sup_details.osup_det;
    // Net outward tax = tax on both bills − tax on the credit note (each CGST/SGST split evenly).
    const tax = (mrp: number, rate: number) => mrp - Math.round((mrp * 100) / (100 + rate));
    const expected = tax(11200, 12) + tax(10500, 5) + tax(22400, 12) - tax(11200, 12);
    expect(Math.round((out.camt + out.samt) * 100)).toBe(expected);
    // ITC from the purchase bill (same state: CGST + SGST).
    const itc = g.gstr3b.itc_elg.itc_avl.find((r) => r.ty === "OTH")!;
    expect(Math.round((itc.camt + itc.samt) * 100)).toBe(Math.round(70000 * 0.12) + Math.round(70000 * 0.05));
    expect(g.hsnCsv[0][1]).toBe("HSN");
    expect(g.hsnCsv.some((r) => r[1] === "30049099")).toBe(true);
    expect(g.gstr1Csv[0][0]).toBe("GSTR-1");
    expect(() => gstReturns(db, "2026", GSTIN)).toThrow(/month/);
  });
});
