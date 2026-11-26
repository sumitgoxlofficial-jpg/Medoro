import { beforeEach, describe, expect, it } from "vitest";
import { memoryDb } from "./node";
import type { DriveDB } from "./client";
import { addMedicine, createSale } from "./pharmacy";
import { addCustomer, addSupplier, createReturn, receivePayment, recordPurchase } from "./trade";
import { addExpense, paySupplier } from "./books";
import { customerStatement, dayBook, h1Register, journal, profitAndLoss, supplierStatement, tallyExport, trialBalance } from "./ledger";
import { ACC } from "@/domain/accounting/accounts";
import { todayISO } from "@/lib/dates";

const B = "b1", U = "u1";
let db: DriveDB;
beforeEach(async () => { db = await memoryDb("C1"); });
const today = todayISO();

function shop() {
  const dolo = addMedicine(db, { name: "Dolo 650", gstRate: 5, mrpPaise: 3150, hsn: "3004" });
  const cef = addMedicine(db, { name: "Cefix 200", gstRate: 5, mrpPaise: 10500, schedule: "H1" });
  const sup = addSupplier(db, { name: "Agency" });
  recordPurchase(db, { branchId: B, supplierId: sup.id, billNo: "P1", billDate: today, userId: U, lines: [
    { medicineId: dolo.id, batchNo: "D1", expiryDate: "2030-01-31", packs: 20, costPaise: 2000, mrpPaise: 3150 },
    { medicineId: cef.id, batchNo: "C1", expiryDate: "2030-01-31", packs: 10, costPaise: 7000, mrpPaise: 10500 }] });
  const cust = addCustomer(db, { name: "Asha", phone: "9000010001", creditLimitPaise: 100000 });
  const cash = createSale(db, { branchId: B, series: "C1", userId: U, lines: [{ medicineId: dolo.id, qty: 2 }], pay: { mode: "cash" } }, today);
  createSale(db, { branchId: B, series: "C1", userId: U, customerId: cust.id, lines: [{ medicineId: dolo.id, qty: 3 }], pay: { mode: "credit" } }, today);
  createSale(db, { branchId: B, series: "C1", userId: U, customerId: cust.id, lines: [{ medicineId: cef.id, qty: 1 }], pay: { mode: "split", cashPaise: 5000 },
    prescriber: "Dr Verma", prescriberReg: "JH-1101", patientName: "Asha" }, today);
  receivePayment(db, { customerId: cust.id, amountPaise: 5000, mode: "upi", userId: U });
  const item = String(db.from("saleItem").eq("saleId", cash.saleId).first()!.id);
  createReturn(db, { saleId: cash.saleId, series: "C1", userId: U, reason: "x", condition: "sealed", refundMode: "cash", lines: [{ saleItemId: item, qty: 1 }] }, today);
  paySupplier(db, { supplierId: sup.id, amountPaise: 20000, mode: "bank", ref: "UTR1", userId: U });
  addExpense(db, { branchId: B, category: "Rent", amountPaise: 10000, mode: "cash", userId: U });
  return { dolo, cef, sup, cust };
}

describe("books from the counter's records", () => {
  it("every voucher balances, and so does the trial balance", () => {
    shop();
    const j = journal(db, B, today, today);
    expect(j.map((v) => v.type).sort()).toEqual(["credit_note", "payment", "payment", "purchase", "receipt", "sales", "sales", "sales"].sort());
    for (const v of j) expect(v.lines.reduce((a, l) => a + l.dr - l.cr, 0)).toBe(0);
    const tb = trialBalance(db, B, today, today);
    expect(tb.drPaise).toBe(tb.crPaise);
    expect(tb.rows.find((r) => r.account === ACC.purchases)?.drPaise).toBeGreaterThan(0);
    expect(dayBook(db, B, today)).toHaveLength(j.length);
  });

  it("profit & loss: net sales − cost of goods sold − expenses", () => {
    shop();
    const p = profitAndLoss(db, B, today, today);
    // Cost: 5 Dolo at ₹20 + 1 Cefix at ₹70, less 1 sealed Dolo returned = ₹150.
    expect(p.cogsPaise).toBe(15000);
    expect(p.grossPaise).toBe(p.netSalesPaise - 15000);
    expect(p.expensesPaise).toBe(10000);
    expect(p.netPaise).toBe(p.grossPaise - 10000 + p.roundOffPaise - p.loyaltyPaise);
    expect(p.bills).toBe(3);
    expect(p.returns).toBe(1);
  });

  it("customer and supplier statements carry a running balance", () => {
    const { cust, sup } = shop();
    const c = customerStatement(db, cust.id);
    // Bill on account (3 × ₹31.50 = ₹94.50, rounded off); the split bill was paid at the counter; ₹50 received.
    expect(c.rows.map((r) => r.kind)).toEqual(["Bill on account", "Received (upi)"]);
    expect(c.closingPaise).toBe(c.rows[0].debitPaise - 5000);
    expect(c.rows[0].debitPaise).toBe(9500); // ₹94.50 rounded to the rupee
    const s = supplierStatement(db, sup.id);
    expect(s.rows[0]).toMatchObject({ kind: "Purchase bill", creditPaise: s.rows[0].creditPaise });
    expect(s.closingPaise).toBe(s.rows[0].creditPaise - 20000);
    expect(customerStatement(db, cust.id, "2099-01-01", "2099-01-31").openingPaise).toBe(c.closingPaise);
  });

  it("Schedule H1 register lists the prescriber, patient and batch", () => {
    shop();
    const r = h1Register(db, B, today, today);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ medicine: "Cefix 200", patient: "Asha", prescriber: "Dr Verma", reg: "JH-1101", batchNo: "C1", qty: 1, complete: true });
  });

  it("Tally export: vouchers whose amounts add to zero, and party ledgers", () => {
    shop();
    const t = tallyExport(db, B, today, today, "Demo Pharmacy");
    expect(t.vouchers).toBe(8);
    expect(t.vouchersXml).toContain("<VOUCHERTYPENAME>Sales</VOUCHERTYPENAME>");
    expect(t.mastersXml).toContain('<LEDGER NAME="Asha"');
    expect(t.mastersXml).toContain('<LEDGER NAME="Agency"');
    for (const v of t.vouchersXml.split("<VOUCHER ").slice(1)) {
      const sum = [...v.matchAll(/<AMOUNT>(-?[\d.]+)<\/AMOUNT>/g)].reduce((a, m) => a + Math.round(Number(m[1]) * 100), 0);
      expect(sum).toBe(0);
    }
  });
});
