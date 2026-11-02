import { beforeEach, describe, expect, it } from "vitest";
import { memoryDb } from "./node";
import type { DriveDB } from "./client";
import { addMedicine, createSale, receiveStock } from "./pharmacy";
import { addCustomer, addSupplier, customerBalance, recordPurchase } from "./trade";
import { supplierDues } from "./books";
import { openBills } from "./money";
import { bounceCheque, cancelCheque, chequesDue, chequeTotals, clearCheque, depositCheque, listCheques, recordCheque } from "./cheques";
import { addDays, todayISO } from "@/lib/dates";

const B = "b1", U = "u1";
const today = todayISO();
let db: DriveDB;
beforeEach(async () => { db = await memoryDb("C1"); });

/** A credit customer owing ₹320 (one credit bill). */
function owingCustomer() {
  const m = addMedicine(db, { name: "Dolo 650", gstRate: 12, mrpPaise: 3200 });
  receiveStock(db, { branchId: B, medicineId: m.id, batchNo: "D1", expiryDate: "2030-01-31", qty: 100, costPaise: 2000, mrpPaise: 3200, userId: U });
  const c = addCustomer(db, { name: "Ramesh", phone: "9876543210", creditLimitPaise: 1_000_00 });
  createSale(db, { branchId: B, series: "C1", userId: U, customerId: c.id, lines: [{ medicineId: m.id, qty: 10 }], pay: { mode: "credit" } });
  return c;
}
/** A supplier owed ₹224 (one purchase bill). */
function owedSupplier() {
  const m = addMedicine(db, { name: "Pan 40", gstRate: 12, mrpPaise: 3200 });
  const s = addSupplier(db, { name: "Agency" });
  recordPurchase(db, { branchId: B, supplierId: s.id, billNo: "P1", billDate: today, userId: U, lines: [{ medicineId: m.id, batchNo: "A", expiryDate: "2030-01-31", packs: 10, costPaise: 2000, mrpPaise: 3200 }] });
  return s;
}
const chq = (direction: "received" | "issued", partyId: string, amountPaise: number, chequeDate = today, chequeNo = "123456") =>
  recordCheque(db, { direction, partyId, chequeNo, bank: "SBI", chequeDate, amountPaise, userId: U }, today);

describe("cheques received", () => {
  it("recording reduces what the customer owes; clearing doesn't move it again", () => {
    const c = owingCustomer();
    const due = customerBalance(db, c.id);
    const { id } = chq("received", c.id, 20000);
    expect(customerBalance(db, c.id)).toBe(due - 20000);
    expect(() => clearCheque(db, id, today, U, today)).toThrow(/Deposit cheque 123456 first/);
    depositCheque(db, id, U, today);
    expect(() => depositCheque(db, id, U, today)).toThrow(/already deposited/);
    expect(() => clearCheque(db, id, addDays(today, 1), U, today)).toThrow(/future/);
    clearCheque(db, id, today, U, today);
    expect(customerBalance(db, c.id)).toBe(due - 20000);
    expect(listCheques(db, {}, today)[0]).toMatchObject({ status: "cleared", party: "Ramesh", depositedOn: today, endedOn: today });
    expect(() => bounceCheque(db, { chequeId: id, reason: "funds insufficient", branchId: B, userId: U }, today)).toThrow(/cleared; it can’t bounce/);
  });

  it("refuses stale, far-future, duplicate and over-the-balance cheques", () => {
    const c = owingCustomer();
    expect(() => chq("received", c.id, 1000, addDays(today, -91))).toThrow(/stale/);
    expect(() => chq("received", c.id, 1000, addDays(today, 400))).toThrow(/more than a year/);
    expect(() => chq("received", c.id, 99_999_00)).toThrow(/owes only/);
    expect(() => recordCheque(db, { direction: "received", partyId: c.id, chequeNo: "12345", bank: "SBI", chequeDate: today, amountPaise: 1000, userId: U }, today)).toThrow(/6 digits/);
    chq("received", c.id, 1000);
    expect(() => chq("received", c.id, 1000)).toThrow(/already recorded/);
  });

  it("a post-dated cheque can't be deposited or cleared before its date, and shows as due", () => {
    const c = owingCustomer();
    const { id } = chq("received", c.id, 5000, addDays(today, 2));
    expect(() => depositCheque(db, id, U, today)).toThrow(/post-dated/);
    expect(depositCheque(db, id, U, addDays(today, 2)).status).toBe("deposited");
    expect(() => clearCheque(db, id, addDays(today, 1), U, addDays(today, 3))).toThrow(/can’t clear before/);
    expect(chequesDue(db, 3, today)).toMatchObject({ count: 1, receivedPaise: 5000, issuedPaise: 0 });
    expect(chequesDue(db, 1, today).count).toBe(0);
    expect(chequeTotals(db, today)).toMatchObject({ inHandPaise: 5000, issuedPaise: 0, dueSoon: 1 });
  });

  it("a bounce puts the amount and the recovered charge back on the account, with new rows only", () => {
    const c = owingCustomer();
    const due = customerBalance(db, c.id);
    const { id } = chq("received", c.id, due);
    expect(customerBalance(db, c.id)).toBe(0);
    expect(openBills(db).length).toBe(0);
    depositCheque(db, id, U, today);
    const r = bounceCheque(db, { chequeId: id, reason: "funds insufficient", chargePaise: 30000, bankChargePaise: 15000, branchId: B, userId: U }, today);
    expect(r.owedPaise).toBe(due + 30000);
    expect(customerBalance(db, c.id)).toBe(due + 30000);
    expect(openBills(db)[0].balancePaise).toBe(due);
    expect(db.engine.all<{ category: string; amountPaise: number }>("SELECT category, amountPaise FROM expense")).toEqual([{ category: "Bank charges", amountPaise: 15000 }]);
    expect(listCheques(db, {}, today)[0]).toMatchObject({ status: "bounced", reason: "funds insufficient", chargePaise: 30000 });
    // The original receipt is still there, untouched; it can't be edited even with raw SQL.
    expect(() => db.engine.run("DELETE FROM customerReceipt")).toThrow(/cannot be deleted/);
    expect(() => db.engine.run("UPDATE chequeEvent SET kind = 'cleared'")).toThrow(/cannot be changed/);
    // The same cheque can be presented again after a bounce.
    expect(chq("received", c.id, due).status).toBe("pending");
  });

  it("cancelling a cheque not yet deposited reverses the receipt; a deposited one can't be cancelled", () => {
    const c = owingCustomer();
    const due = customerBalance(db, c.id);
    const a = chq("received", c.id, 10000, today, "111111");
    cancelCheque(db, { chequeId: a.id, reason: "paid cash instead", userId: U }, today);
    expect(customerBalance(db, c.id)).toBe(due);
    expect(() => cancelCheque(db, { chequeId: a.id, reason: "again", userId: U }, today)).toThrow(/cancelled/);
    const b = chq("received", c.id, 10000, today, "222222");
    depositCheque(db, b.id, U, today);
    expect(() => cancelCheque(db, { chequeId: b.id, reason: "oops", userId: U }, today)).toThrow(/with the bank/);
  });
});

describe("cheques issued", () => {
  it("paying a supplier by cheque reduces dues; a bounce restores them plus the penalty", () => {
    const s = owedSupplier();
    const owed = supplierDues(db)[0].duePaise;
    expect(() => chq("issued", s.id, owed + 100)).toThrow(/owed only/);
    const { id } = chq("issued", s.id, 20000);
    expect(supplierDues(db)[0].duePaise).toBe(owed - 20000);
    expect(() => depositCheque(db, id, U, today)).toThrow(/Only cheques you received/);
    bounceCheque(db, { chequeId: id, reason: "signature differs", chargePaise: 50000, branchId: B, userId: U }, today);
    expect(supplierDues(db)[0].duePaise).toBe(owed + 50000);
    expect(db.engine.all("SELECT 1 FROM expense").length).toBe(0);
  });

  it("an issued cheque clears straight from pending", () => {
    const s = owedSupplier();
    const { id } = chq("issued", s.id, 10000);
    clearCheque(db, id, today, U, today);
    expect(listCheques(db, { open: true }, today)).toEqual([]);
    expect(listCheques(db, {}, today)[0].status).toBe("cleared");
  });
});

describe("two counters offline", () => {
  it("both bouncing the same cheque leaves one reversal, and clear-vs-bounce keeps the bounce", async () => {
    const c = owingCustomer();
    const due = customerBalance(db, c.id);
    const { id } = chq("received", c.id, 10000);
    // Simulate the other counter's rows arriving by sync (INSERT OR IGNORE on the same ids).
    const other = await memoryDb("C2");
    const mine = db.pendingChanges(5000);
    for (const x of mine) other.applyRemote(x);
    bounceCheque(other, { chequeId: id, reason: "funds insufficient", branchId: B, userId: U }, today);
    depositCheque(db, id, U, today);
    clearCheque(db, id, today, U, today);
    for (const x of other.pendingChanges(5000)) db.applyRemote(x);
    expect(customerBalance(db, c.id)).toBe(due);
    expect(listCheques(db, {}, today)[0]).toMatchObject({ status: "bounced", conflict: true });
  });
});
