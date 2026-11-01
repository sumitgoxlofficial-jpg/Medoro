import { beforeEach, describe, expect, it } from "vitest";
import { memoryDb } from "./node";
import type { DriveDB } from "./client";
import { addMedicine, createSale, receiveStock, CounterError } from "./pharmacy";
import { addCustomer, customerBalance, receivePayment } from "./trade";
import {
  approveAllUnique, approveSuggestion, counterNotSeen, importHistory, importStatement, manualMatch, openBills, overview, finReports, reconciliation,
  rejectSuggestion, resolveDuplicate, saveFinSettings, setIgnored, statementPreview, transactions, unallocate,
} from "./money";
import { medoroRef } from "@/domain/finance/match";
import { TABLES } from "./schema";

const B = "branch-main", U = "user-1";
let db: DriveDB;
let medId = "";
beforeEach(async () => {
  db = await memoryDb("C1");
  medId = addMedicine(db, { name: "Dolo 650", gstRate: 12, mrpPaise: 10000 }).id;
  receiveStock(db, { branchId: B, medicineId: medId, batchNo: "A", expiryDate: "2028-12-31", qty: 1000, costPaise: 6000, mrpPaise: 10000, userId: U });
});

/** A bill of `packs` × ₹100. */
const bill = (packs: number, extra: Record<string, unknown> = {}) =>
  createSale(db, { branchId: B, series: "C1", userId: U, lines: [{ medicineId: medId, qty: packs }], pay: { mode: "cash" }, ...extra });
const creditBill = (customerId: string, packs: number) => bill(packs, { customerId, pay: { mode: "credit" } });
const customer = (name: string, phone: string) => addCustomer(db, { name, phone, creditLimitPaise: 10_000_000 });

const enc = (s: string) => new TextEncoder().encode(s);
const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
const [y, m, d] = today.split("-");
const dmy = `${d}/${m}/${y}`;
/** A statement in HDFC's CSV layout; rows are [narration, ref, debit, credit]. */
const csv = (rows: [string, string, string, string][], date = dmy) =>
  enc(["Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance", ...rows.map(([n, r, dr, cr]) => `${date},"${n}",${r},${date},${dr},${cr},`)].join("\n"));
const imp = (rows: [string, string, string, string][], file = "s.csv", date = dmy) =>
  importStatement(db, { fileName: file, bytes: csv(rows, date), bank: "HDFC", last4: "4321", userId: U });

it("migration 8 creates exactly the tables the SDK allows, and receipts accept bank transfers", () => {
  for (const t of ["finImport", "finTxn", "finSource", "finEvent", "finAllocation", "customerReceipt"] as const) {
    expect(db.engine.all<{ name: string }>(`PRAGMA table_info(${t})`).map((r) => r.name).sort()).toEqual([...TABLES[t].columns].sort());
  }
  const c = customer("Asha", "9822000001");
  expect(() => db.from("customerReceipt").insert({ customerId: c.id, amountPaise: 100, mode: "bank", userId: U, at: "x" })).not.toThrow();
  expect(() => db.engine.run("UPDATE finTxn SET amountPaise = 1")).not.toThrow(); // empty: trigger fires per row
});

describe("statement import", () => {
  it("previews, imports credits and debits with UTRs, and a second import of the same file adds nothing", () => {
    const rows: [string, string, string, string][] = [
      ["UPI-RAHUL KUMAR-rahul@okhdfcbank-HDFC0001234-430512345678-PAY", "0000430512345678", "", "850.00"],
      ["UPI-ASHA-asha@ybl-YESB0000001-430598765432-PAY", "0000430598765432", "1200.00", ""],
      ["CASH DEPOSIT", "", "", "2000.00"],
    ];
    const p = statementPreview(db, "s.csv", csv(rows), "HDFC");
    expect(p).toMatchObject({ needsMapping: false, count: 3, credits: 2, debits: 1 });
    const r = imp(rows);
    expect(r).toMatchObject({ rows: 3, added: 3, duplicates: 0, review: 0 });
    const t = transactions(db);
    expect(t.map((x) => [x.direction, x.amountPaise, x.utr, x.channel, x.state]).sort()).toEqual([
      ["credit", 200000, null, "cash", "not_payment"], ["credit", 85000, "430512345678", "upi", "unmatched"], ["debit", 120000, "430598765432", "upi", "debit"],
    ].sort());
    expect(imp(rows)).toMatchObject({ added: 0, duplicates: 3 });
    expect(importHistory(db)).toHaveLength(2);
  });

  it("asks for the columns when it can't find them, and remembers them for the bank", () => {
    const bytes = enc("a,b,c\n01/11/2026,UPI x,500\n");
    const p = statementPreview(db, "x.csv", bytes, "SBI");
    expect(p.needsMapping).toBe(true);
    const mapping = { headerRow: 0, cols: { date: 0, description: 1, amount: 2 } };
    expect(importStatement(db, { fileName: "x.csv", bytes, bank: "SBI", last4: "1111", mapping, userId: U })).toMatchObject({ added: 1 });
    expect(statementPreview(db, "x.csv", bytes, "SBI").needsMapping).toBe(false);
  });

  it("refuses an unreadable file, a missing account and an empty statement", () => {
    expect(() => importStatement(db, { fileName: "s.pdf", bytes: enc("%PDF"), bank: "HDFC", last4: "4321", userId: U })).toThrow(/Excel or CSV/);
    expect(() => importStatement(db, { fileName: "s.csv", bytes: csv([["x", "", "", "1.00"]]), bank: "HDFC", last4: "43", userId: U })).toThrow(/last 4 digits/);
    expect(() => importStatement(db, { fileName: "s.csv", bytes: enc("Date,Narration,Deposit Amt.,Withdrawal Amt.\n"), bank: "HDFC", last4: "4321", userId: U })).toThrow(/No transactions/);
  });

  it("the same payment in an overlapping statement from another format is merged by UTR; doubtful ones go to review", () => {
    imp([["UPI-R-r@ok-HDFC0001-430512345678-x", "", "", "850.00"], ["BY CLG 1", "", "", "700.00"]]);
    // Same payments, narration written differently (another export of the same days).
    const r = imp([["UPI/430512345678/r@ok", "", "", "850.00"], ["CLEARING 1", "", "", "700.00"]], "s.xlsx.csv");
    expect(r).toMatchObject({ added: 1, duplicates: 1, review: 1 });
    const q = reconciliation(db);
    expect(q.duplicates).toHaveLength(1);
    expect(q.duplicates[0].other?.description).toBe("BY CLG 1");
    // A doubtful row can't be matched until someone decides.
    resolveDuplicate(db, q.duplicates[0].id, true, U);
    expect(transactions(db, { state: "duplicate" })).toHaveLength(1);
    expect(overview(db).bankCredits).toBe(2); // the copy isn't counted
  });
});

describe("matching bills", () => {
  it("Medoro reference in the narration pays that bill automatically, and the customer's balance follows", () => {
    const c = customer("Rahul", "9822000001");
    const s = creditBill(c.id, 3); // ₹300
    expect(imp([[`UPI-RAHUL-rahul@ok-HDFC0001-430512345678-${medoroRef(s.invoiceNo)}`, "", "", "300.00"]])).toMatchObject({ matched: 1 });
    expect(customerBalance(db, c.id)).toBe(0);
    expect(transactions(db)[0]).toMatchObject({ state: "matched", links: [{ target: "bill", kind: "auto", rule: 1 }] });
    expect(openBills(db)).toEqual([]);
  });

  it("partial payment, then a second payment: the bill shows part paid, then paid", () => {
    const c = customer("Hospital", "9822000002");
    const s = creditBill(c.id, 10); // ₹1000
    imp([[`NEFT CR-SBIN0001-CITY HOSPITAL-SBIN426306123456 ${s.invoiceNo}`, "", "", "400.00"]]);
    expect(openBills(db)[0]).toMatchObject({ saleId: s.saleId, balancePaise: 60000, paidPaise: 40000 });
    expect(reconciliation(db).partialBills).toHaveLength(1);
    imp([[`NEFT CR-SBIN0001-CITY HOSPITAL-SBIN426306999999 ${s.invoiceNo}`, "", "", "600.00"]], "s2.csv");
    expect(openBills(db)).toEqual([]);
    expect(customerBalance(db, c.id)).toBe(0);
    // The receipts are bank transfers, not UPI.
    expect(db.engine.all<{ mode: string }>("SELECT mode FROM customerReceipt").map((r) => r.mode)).toEqual(["bank", "bank"]);
  });

  it("paying more than the bill allocates the bill's balance and leaves the rest unmatched", () => {
    const c = customer("Rahul", "9822000001");
    const s = creditBill(c.id, 2); // ₹200
    imp([[`UPI-RAHUL-r@ok-H-430512345678-${medoroRef(s.invoiceNo)}`, "", "", "250.00"]]);
    expect(transactions(db)[0]).toMatchObject({ state: "partial", allocatedPaise: 20000 });
    expect(customerBalance(db, c.id)).toBe(0);
  });

  it("amount alone is a suggestion, never automatic; approving records it", () => {
    const c = customer("Rahul", "9822000001");
    const s = creditBill(c.id, 3);
    expect(imp([["UPI-RAHUL-rahul@ok-HDFC0001-430512345678-PAY", "", "", "300.00"]])).toMatchObject({ matched: 0 });
    const q = reconciliation(db);
    expect(q.suggested).toHaveLength(1);
    expect(q.suggested[0].suggestions[0]).toMatchObject({ targetId: s.saleId, rule: 4, auto: false });
    approveSuggestion(db, q.suggested[0].id, s.saleId, U);
    expect(customerBalance(db, c.id)).toBe(0);
  });

  it("two bills of the same amount: both suggested, nothing automatic; a rejected one is not suggested again", () => {
    const a = customer("A", "9822000001"), b = customer("B", "9822000002");
    const s1 = creditBill(a.id, 3), s2 = creditBill(b.id, 3);
    imp([["UPI-X-x@ok-H-430512345678-PAY", "", "", "300.00"]]);
    const [t] = reconciliation(db).suggested;
    expect(t.suggestions.map((p) => [p.targetId, p.rule])).toEqual([[s1.saleId, 5], [s2.saleId, 5]]);
    expect(approveAllUnique(db, U)).toBe(0);
    rejectSuggestion(db, t.id, s1.saleId, U);
    expect(reconciliation(db).suggested[0].suggestions.map((p) => p.targetId)).toEqual([s2.saleId]);
  });

  it("a known payer's UPI ID matches automatically only when the owner allows it", () => {
    const c = customer("Rahul", "9822000001");
    const s1 = creditBill(c.id, 3);
    imp([["UPI-RAHUL-rahul@ok-HDFC0001-430512345678-PAY", "", "", "300.00"]]);
    approveSuggestion(db, reconciliation(db).suggested[0].id, s1.saleId, U);
    creditBill(c.id, 4);
    saveFinSettings(db, { upiId: "", payee: "", autoKnownPayers: true });
    expect(imp([["UPI-RAHUL-rahul@ok-HDFC0001-430512399999-PAY", "", "", "400.00"]], "s2.csv")).toMatchObject({ matched: 1 });
  });

  it("manual match with the amount a person chooses; wrong amounts are refused; undo restores the balance", () => {
    const c = customer("Rahul", "9822000001");
    const s = creditBill(c.id, 3);
    imp([["NEFT FROM SOMEONE", "", "", "500.00"]]);
    const [t] = transactions(db);
    expect(() => manualMatch(db, { txnId: t.id, target: "bill", targetId: s.saleId, amountPaise: 40000, userId: U })).toThrow(/only ₹300.00 left/);
    expect(() => manualMatch(db, { txnId: t.id, target: "bill", targetId: s.saleId, amountPaise: 60000, userId: U })).toThrow(/Only ₹500.00/);
    manualMatch(db, { txnId: t.id, target: "bill", targetId: s.saleId, amountPaise: 30000, userId: U });
    expect(customerBalance(db, c.id)).toBe(0);
    const [link] = transactions(db)[0].links;
    unallocate(db, link.allocationId, U);
    expect(customerBalance(db, c.id)).toBe(30000);
    expect(transactions(db)[0]).toMatchObject({ state: "unmatched", links: [] });
    expect(() => unallocate(db, link.allocationId, U)).toThrow(/already undone/);
  });

  it("a debit can't be matched to a bill, and a set-aside credit can't either", () => {
    const c = customer("Rahul", "9822000001");
    const s = creditBill(c.id, 3);
    imp([["UPI OUT", "", "300.00", ""], ["OWN TRANSFER", "", "", "300.00"]]);
    const debit = transactions(db, { direction: "debit" })[0], credit = transactions(db, { direction: "credit" })[0];
    expect(() => manualMatch(db, { txnId: debit.id, target: "bill", targetId: s.saleId, amountPaise: 30000, userId: U })).toThrow(/Only money received/);
    setIgnored(db, credit.id, true, "Owner's own transfer", U);
    expect(() => manualMatch(db, { txnId: credit.id, target: "bill", targetId: s.saleId, amountPaise: 30000, userId: U })).toThrow(CounterError);
    expect(overview(db).bankCredits).toBe(0);
  });

  it("receipts typed at the counter pay the oldest bills first, and a bank credit with their UTR confirms them instead of paying twice", () => {
    const c = customer("Rahul", "9822000001");
    const s1 = creditBill(c.id, 2), s2 = creditBill(c.id, 3);
    receivePayment(db, { customerId: c.id, amountPaise: 30000, mode: "upi", ref: "430512345678", userId: U });
    expect(openBills(db).map((b) => [b.saleId, b.balancePaise])).toEqual([[s2.saleId, 20000]]);
    expect(s1.saleId).toBeTruthy();
    imp([["UPI-RAHUL-rahul@ok-HDFC0001-430512345678-PAY", "", "", "300.00"]]);
    expect(transactions(db)[0]).toMatchObject({ state: "matched", links: [{ target: "receipt", rule: 2 }] });
    expect(customerBalance(db, c.id)).toBe(20000); // not paid twice
  });
});

describe("counter UPI", () => {
  it("UTR typed at the counter confirms the payment; one that never reached the bank is flagged", () => {
    bill(3, { pay: { mode: "upi", ref: "430512345678" } });
    const fake = bill(2, { pay: { mode: "upi" } });
    imp([["UPI-RAHUL-r@ok-H-430512345678-PAY", "", "", "300.00"]]);
    expect(transactions(db)[0].links[0]).toMatchObject({ target: "counter", rule: 2, kind: "auto" });
    expect(counterNotSeen(db).map((p) => p.saleId)).toEqual([]); // statement must cover the following days too
    imp([["INTEREST", "", "", "1.00"]], "later.csv", (() => { const t = new Date(Date.now() + 330 * 60_000 + 5 * 86400_000).toISOString().slice(0, 10).split("-"); return `${t[2]}/${t[1]}/${t[0]}`; })());
    expect(counterNotSeen(db).map((p) => p.saleId)).toEqual([fake.saleId]);
  });

  it("same amount without a UTR is a one-to-one suggestion, approved in bulk", () => {
    const s = bill(3, { pay: { mode: "upi" } });
    imp([["UPI-RAHUL-r@ok-H-430512345678-PAY", "", "", "300.00"]]);
    expect(reconciliation(db).suggested[0].suggestions[0]).toMatchObject({ target: "counter", saleId: s.saleId, rule: 4, auto: false });
    expect(approveAllUnique(db, U)).toBe(1);
    expect(reconciliation(db).counterUnverified).toEqual([]);
  });
});

describe("reports", () => {
  it("totals credits by day, month, account and channel, excluding set-aside rows", () => {
    imp([["UPI-A-a@ok-H-430512345678-x", "", "", "100.00"], ["NEFT CR-X-SBIN426306123456", "", "", "50.00"], ["CHQ PAID", "", "20.00", ""], ["MINE", "", "", "999.00"]]);
    setIgnored(db, transactions(db, { q: "MINE" })[0].id, true, "", U);
    const r = finReports(db, today, today);
    expect(r.totals).toMatchObject({ credits: 2, creditPaise: 15000, debitPaise: 2000 });
    expect(r.daily).toEqual([{ key: today, count: 2, totalPaise: 15000, upiPaise: 10000, matchedPaise: 0 }]);
    expect(r.byChannel.map((g) => g.key)).toEqual(["neft", "upi"]);
    expect(r.byAccount[0].key).toBe("HDFC Bank ••4321");
    expect(() => finReports(db, today, "2000-01-01")).toThrow(/date range/);
  });
});

it("settings refuse something that isn't a UPI ID", () => {
  expect(() => saveFinSettings(db, { upiId: "not a vpa", payee: "", autoKnownPayers: false })).toThrow(/UPI ID/);
  expect(saveFinSettings(db, { upiId: "shop@okhdfcbank", payee: "Shop", autoKnownPayers: false }).upiId).toBe("shop@okhdfcbank");
});
