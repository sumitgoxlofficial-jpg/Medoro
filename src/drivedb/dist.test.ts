import { beforeEach, describe, expect, it } from "vitest";
import { memoryDb } from "./node";
import type { DriveDB } from "./client";
import { addMedicine, receiveStock } from "./pharmacy";
import { addCustomer, customerBalance, receivePayment } from "./trade";
import { cancelInvoice, creditFor, directInvoice, distSeries, invoiceView, listInvoices, saveChemist, saveCompany, saveDistSettings, saveProduct, saveScheme, setChemistStatus, setSpecialRate } from "./dist";
import { addDays, todayISO } from "@/lib/dates";

const G = "godown-1", U = "u1", today = todayISO();
let db: DriveDB, med = "", chem = "", n = 0;
const key = () => `bill-key-${++n}-${Date.now()}`;
const stockUnits = (batch: string) => Number(db.engine.all<{ q: number }>("SELECT COALESCE(SUM(qty), 0) AS q FROM stockMovement WHERE batchId = (SELECT id FROM batch WHERE batchNo = ?)", [batch])[0].q);

beforeEach(async () => {
  db = await memoryDb("DIST1");
  db.setMeta("pharmacy", JSON.stringify({ gstin: "27AAKFS3192P1Z6" }));
  // Dolo 650, strip of 15: PTR ₹24.00 a strip, GST 12%. Two batches, the earlier one expires first.
  med = addMedicine(db, { name: "Dolo 650", gstRate: 12, mrpPaise: 3200, packSize: 15 }).id;
  receiveStock(db, { branchId: G, medicineId: med, batchNo: "EARLY", expiryDate: addDays(today, 200), qty: 15 * 20, costPaise: 2000, mrpPaise: 3200, userId: U });
  receiveStock(db, { branchId: G, medicineId: med, batchNo: "LATE", expiryDate: addDays(today, 400), qty: 15 * 100, costPaise: 2000, mrpPaise: 3200, userId: U });
  const co = saveCompany(db, null, { name: "Micro Labs" });
  saveProduct(db, { medicineId: med, companyId: co, ptrPaise: 2400, ptsPaise: 2200 });
  chem = addCustomer(db, { name: "Shree Medical", phone: "9822000111", creditLimitPaise: 50_000_00 }).id;
  saveChemist(db, { customerId: chem, stateCode: "27", dl20b: "MH-PZ-123", dlExpiry: addDays(today, 300), creditDays: 21 });
});

describe("wholesale invoice on the device", () => {
  it("prices at PTR + GST, takes stock FEFO in whole packs, and the chemist owes the total", () => {
    const r = directInvoice(db, { branchId: G, customerId: chem, userId: U, idempotencyKey: key(), lines: [{ medicineId: med, qty: 25 }] }, today);
    // 25 strips × ₹24 = ₹600 taxable, 12% GST = ₹72 (CGST 36 + SGST 36), total ₹672.
    expect(r.total).toBe(67200);
    expect(r.no).toMatch(new RegExp(`^${distSeries(db)}\\d{4}-00001$`));
    const v = invoiceView(db, r.invoiceId)!;
    expect(v).toMatchObject({ taxablePaise: 60000, cgstPaise: 3600, sgstPaise: 3600, igstPaise: 0, igst: 0 });
    // FEFO: the 20 strips of the earlier batch first, then 5 of the later one.
    expect(v.lines.map((l) => [l.batchNo, l.qty])).toEqual([["EARLY", 20], ["LATE", 5]]);
    expect(stockUnits("EARLY")).toBe(0);
    expect(stockUnits("LATE")).toBe(15 * 95);
    expect(customerBalance(db, chem)).toBe(67200);
    // A retried bill with the same key is the same invoice.
    const k = key();
    const a = directInvoice(db, { branchId: G, customerId: chem, userId: U, idempotencyKey: k, lines: [{ medicineId: med, qty: 1 }] }, today);
    expect(directInvoice(db, { branchId: G, customerId: chem, userId: U, idempotencyKey: k, lines: [{ medicineId: med, qty: 1 }] }, today)).toMatchObject({ invoiceId: a.invoiceId, replayed: true });
  });

  it("charges IGST to a chemist in another state", () => {
    saveChemist(db, { customerId: chem, stateCode: "29", dl20b: "KA-1", dlExpiry: addDays(today, 300) });
    const v = invoiceView(db, directInvoice(db, { branchId: G, customerId: chem, userId: U, idempotencyKey: key(), lines: [{ medicineId: med, qty: 10 }] }, today).invoiceId)!;
    expect(v).toMatchObject({ igst: 1, igstPaise: 2880, cgstPaise: 0, sgstPaise: 0, placeOfSupply: "29" });
  });

  it("applies the price tier, a special rate, and the best scheme (free goods at zero value)", () => {
    saveChemist(db, { customerId: chem, stateCode: "27", dlExpiry: addDays(today, 300), priceTier: "pts" });
    saveScheme(db, { code: "DOLO10", name: "10+1", kind: "free", medicineId: med, buyQty: 10, freeQty: 1, validFrom: today, validTo: addDays(today, 30) });
    const v = invoiceView(db, directInvoice(db, { branchId: G, customerId: chem, userId: U, idempotencyKey: key(), lines: [{ medicineId: med, qty: 20 }] }, today).invoiceId)!;
    // PTS ₹22 × 20 = ₹440 + 12%; 2 free strips go out at zero value.
    expect(v.taxablePaise).toBe(44000);
    expect(v.lines.reduce((a, l) => a + Number(l.freeQty), 0)).toBe(2);
    expect(stockUnits("EARLY")).toBe(0); // 22 strips taken: the 20 early ones first
    setSpecialRate(db, chem, med, 2000, addDays(today, 10));
    const w = invoiceView(db, directInvoice(db, { branchId: G, customerId: chem, userId: U, idempotencyKey: key(), lines: [{ medicineId: med, qty: 5 }] }, today).invoiceId)!;
    expect(w.taxablePaise).toBe(10000);
  });

  it("holds credit beyond the limit or overdue bills, lets a manager override with a reason, and refuses hard stops", () => {
    const big = (qty: number, extra: Record<string, unknown> = {}) => directInvoice(db, { branchId: G, customerId: chem, userId: U, idempotencyKey: key(), lines: [{ medicineId: med, qty }], ...extra }, today);
    db.engine.run("UPDATE customer SET creditLimitPaise = 50000 WHERE id = ?", [chem]); // ₹500 limit
    expect(() => big(25)).toThrow(/Credit hold: Credit limit exceeded/);
    expect(() => big(25, { canOverride: true })).toThrow(/Enter a reason/);
    expect(big(25, { canOverride: true, overrideReason: "Pays on Friday, approved by owner" }).total).toBe(67200);
    expect(creditFor(db, chem, 0, today)).toMatchObject({ ok: false, balance: 67200 });
    // A payment brings it back under the limit.
    receivePayment(db, { customerId: chem, amountPaise: 67200, mode: "upi", userId: U });
    expect(creditFor(db, chem, 10000, today).ok).toBe(true);
    // Blocked, or no valid drug licence: no override.
    setChemistStatus(db, chem, "blocked", "Cheque bounced twice");
    expect(() => big(1, { canOverride: true, overrideReason: "Trying anyway" })).toThrow(/Can’t bill: Account is blocked/);
    setChemistStatus(db, chem, "active", "");
    saveChemist(db, { customerId: chem, stateCode: "27", dlExpiry: addDays(today, -1) });
    expect(() => big(1, { canOverride: true, overrideReason: "Trying anyway" })).toThrow(/Drug licence expired/);
    // Block mode refuses a hold outright.
    saveChemist(db, { customerId: chem, stateCode: "27", dlExpiry: addDays(today, 300) });
    saveDistSettings(db, { creditMode: "block" });
    expect(() => big(25, { canOverride: true, overrideReason: "Pays on Friday" })).toThrow(/Credit rules block this bill/);
  });

  it("refuses short stock, stock inside the minimum shelf life, unknown products and rates below list without a manager", () => {
    expect(() => directInvoice(db, { branchId: G, customerId: chem, userId: U, idempotencyKey: key(), lines: [{ medicineId: med, qty: 500 }] }, today)).toThrow(/only 120 packs available/);
    saveDistSettings(db, { minShelfDays: 300 }); // the early batch (200 days left) is too short-dated now
    expect(() => directInvoice(db, { branchId: G, customerId: chem, userId: U, idempotencyKey: key(), lines: [{ medicineId: med, qty: 101 }] }, today)).toThrow(/only 100 packs available/);
    const other = addMedicine(db, { name: "No Terms", gstRate: 12, mrpPaise: 1000 }).id;
    expect(() => directInvoice(db, { branchId: G, customerId: chem, userId: U, idempotencyKey: key(), lines: [{ medicineId: other, qty: 1 }] }, today)).toThrow(/no wholesale rate/);
    expect(() => directInvoice(db, { branchId: G, customerId: chem, userId: U, idempotencyKey: key(), lines: [{ medicineId: med, qty: 1, ratePaise: 1000 }] }, today)).toThrow(/need a manager/);
  });

  it("cancels only today's invoice, puts the stock back, and clears what the chemist owes", () => {
    const r = directInvoice(db, { branchId: G, customerId: chem, userId: U, idempotencyKey: key(), lines: [{ medicineId: med, qty: 25 }] }, today);
    expect(() => cancelInvoice(db, { invoiceId: r.invoiceId, reason: "no", userId: U }, today)).toThrow(/reason/);
    expect(() => cancelInvoice(db, { invoiceId: r.invoiceId, reason: "Wrong chemist", userId: U }, addDays(today, 1))).toThrow(/Only today’s/);
    cancelInvoice(db, { invoiceId: r.invoiceId, reason: "Wrong chemist", userId: U }, today);
    expect(stockUnits("EARLY")).toBe(15 * 20);
    expect(stockUnits("LATE")).toBe(15 * 100);
    expect(customerBalance(db, chem)).toBe(0);
    expect(listInvoices(db)[0]).toMatchObject({ id: r.invoiceId, cancelled: true });
    expect(() => cancelInvoice(db, { invoiceId: r.invoiceId, reason: "Wrong chemist", userId: U }, today)).toThrow(/already cancelled/);
    // The invoice itself can't be edited or deleted.
    expect(() => db.engine.run("UPDATE distInvoice SET totalPaise = 1 WHERE id = ?", [r.invoiceId])).toThrow(/cannot be changed/);
  });
});
