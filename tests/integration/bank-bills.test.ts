import { beforeEach, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { createMedicine, receiveBatch } from "@/domain/inventory/service";
import { commitSale } from "@/domain/sales/service";
import { receiveFromCustomer, saveCustomer } from "@/domain/parties/service";
import { customerBalance } from "@/domain/parties/balances";
import { bankReconciliation, importBankStatement, matchBankLine } from "@/domain/accounting/bank";
import { allocateBill, billMatching, rejectBillSuggestion, serverOpenBills, unallocateBill } from "@/domain/finance/bills";
import { customerRef, medoroRef } from "@/domain/finance/match";
import { ACC } from "@/domain/accounting/accounts";
import { todayISO, addDays } from "@/lib/dates";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

const ddmm = (iso: string) => iso.split("-").reverse().join("/");
const today = todayISO();
let med = "", batch = "", n = 0;

/** A statement in HDFC's CSV layout: [narration, deposit] rows dated today. */
const statement = (rows: [string, string][], date = today) =>
  new TextEncoder().encode(["Date,Narration,Chq./Ref.No.,Value Dt,Withdrawal Amt.,Deposit Amt.,Closing Balance",
    ...rows.map(([nar, cr]) => `${ddmm(date)},"${nar}",,${ddmm(date)},,${cr},`)].join("\n"));
const upload = async (rows: [string, string][], date = today) => importBankStatement(await ctxFor(), `s${++n}.csv`, statement(rows, date));

async function creditBill(customerId: string, packs: number) {
  return commitSale(await ctxFor(), { idempotencyKey: "k_" + randomUUID(), lines: [{ medicineId: med, batchId: batch, qty: packs }], customerId, discountPct: 0, pay: { mode: "credit" } });
}
async function customer(name: string) {
  return saveCustomer(await ctxFor(), null, { name, phone: "98" + String(Math.floor(Math.random() * 1e8)).padStart(8, "0"), waOptIn: false, creditLimit: "100000" });
}
const bal = async (account: string) => {
  const r = await db.ledgerLine.aggregate({ where: { account }, _sum: { debitPaise: true, creditPaise: true } });
  return Number((r._sum.debitPaise ?? 0n) - (r._sum.creditPaise ?? 0n));
};

describe("self-hosted bill matching from bank statements", () => {
  // A fresh pharmacy per test: receipts posted by one test stay in the books and would match the next test's lines.
  beforeEach(async () => {
    await resetDb(); await makePharmacy();
    const ctx = await ctxFor();
    med = await createMedicine(ctx, { form: "Tablet", manufacturer: "Micro Labs", pack: "10", gstRate: 12, reorderLevel: 0, barcode: "", hsn: "3004", rack: "", name: "Testmed", generic: "Paracetamol", strength: "500 mg", mrp: "100", schedule: "" });
    await receiveBatch(ctx, { medicineId: med, batchNo: "B1", expiry: addDays(today, 400), qty: 1000, cost: "50", mrp: "100", supplierId: null, invoiceNo: "" });
    batch = (await db.batch.findFirstOrThrow({ where: { batchNo: "B1" } })).id;
  });

  it("the bill's Medoro reference pays it: a receipt voucher on the statement date, balance and reconciliation agree", async () => {
    const c = await customer("Pawar Clinic");
    const s = await creditBill(c, 3); // ₹300
    const bank0 = await bal(ACC.bank);
    const r = await upload([[`UPI-PAWAR CLINIC-pawar@okhdfcbank-HDFC0001234-430512345678-${medoroRef(s.invoiceNo)}`, "300.00"]]);
    expect(r).toMatchObject({ imported: 1, matched: 0, billsMatched: 1 });
    expect(await customerBalance(db, (await ctxFor()).tenantId, c)).toBe(0);
    expect(await bal(ACC.bank) - bank0).toBe(30000);
    const v = await db.voucher.findFirstOrThrow({ where: { refType: "bank_receipt" } });
    expect(v.narration).toMatch(new RegExp(`Receipt from Pawar Clinic · bank 430512345678 · for ${s.invoiceNo}`));
    const rec = await bankReconciliation(await ctxFor());
    expect(rec.statement).toEqual([]); // the line is reconciled through its receipt
    expect(rec.books.find((b) => b.no === v.no)).toBeUndefined(); // and the receipt isn't "in books, not on statement"
    expect(rec.matched).toBe(1);
    expect(await db.auditEvent.count({ where: { action: `Bank credit matched to ${s.invoiceNo}` } })).toBe(1);
  });

  it("the customer's reference pays their bills oldest first; part payments and a second payment work", async () => {
    const c = await customer("City Hospital");
    const s1 = await creditBill(c, 2), s2 = await creditBill(c, 3), s3 = await creditBill(c, 4); // ₹200, ₹300, ₹400
    const tenantId = (await ctxFor()).tenantId;
    await upload([[`NEFT CR-SBIN0001234-CITY HOSPITAL-SBIN426306123456 ${customerRef(c)}`, "350.00"]]);
    expect((await serverOpenBills(db, tenantId)).filter((b) => b.customerId === c).map((b) => [b.saleId, b.balancePaise])).toEqual([[s2.saleId, 15000], [s3.saleId, 40000]]);
    expect((await billMatching(await ctxFor())).partBills.map((b) => b.saleId)).toEqual([s2.saleId]);
    await upload([[`NEFT CR-SBIN0001234-CITY HOSPITAL-SBIN426306999999 ${customerRef(c)}`, "550.00"]]);
    expect((await serverOpenBills(db, tenantId)).filter((b) => b.customerId === c)).toEqual([]);
    expect(await customerBalance(db, tenantId, c)).toBe(0);
    expect(s1.saleId).toBeTruthy();
  });

  it("amount alone is a suggestion; approving posts the receipt; rejecting hides it", async () => {
    const a = await customer("Amit"), b = await customer("Bina");
    const sa = await creditBill(a, 5);
    expect(await upload([["UPI-SOMEONE-x@ybl-YESB0000001-430511111111-PAY", "500.00"]])).toMatchObject({ billsMatched: 0 });
    let m = await billMatching(await ctxFor());
    expect(m.suggested).toHaveLength(1);
    expect(m.suggested[0].suggestions[0]).toMatchObject({ targetId: sa.saleId, rule: 4, auto: false });
    await allocateBill(await ctxFor(), { bankLineId: m.suggested[0].id, saleId: sa.saleId });
    expect(await customerBalance(db, (await ctxFor()).tenantId, a)).toBe(0);
    // Two bills of the same amount: both suggested; reject one.
    const s1 = await creditBill(a, 6), s2 = await creditBill(b, 6);
    await upload([["UPI-Y-y@ybl-YESB0000001-430522222222-PAY", "600.00"]]);
    m = await billMatching(await ctxFor());
    expect(m.suggested[0].suggestions.map((p) => [p.targetId, p.rule])).toEqual([[s1.saleId, 5], [s2.saleId, 5]]);
    await rejectBillSuggestion(await ctxFor(), m.suggested[0].id, s1.saleId);
    expect((await billMatching(await ctxFor())).suggested[0].suggestions.map((p) => p.targetId)).toEqual([s2.saleId]);
  });

  it("a receipt already in the books wins over a bill match, and a doubtful case is never automatic", async () => {
    const tenantId = (await ctxFor()).tenantId;
    // The cashier recorded the UPI receipt; the statement line matches that book entry, not the bill again.
    const c = await customer("Desai");
    const s = await creditBill(c, 2);
    await receiveFromCustomer(await ctxFor(), { partyId: c, amount: "200", method: "UPI", ref: "" });
    expect(await upload([[`UPI-DESAI-d@ok-H-430533333333-${medoroRef(s.invoiceNo)}`, "200.00"]])).toMatchObject({ matched: 1, billsMatched: 0 });
    expect(await customerBalance(db, tenantId, c)).toBe(0);
    expect(await db.bankAllocation.count()).toBe(0);
    // Two ₹700 credits and one ₹700 receipt in the books: the ledger can't tell which, so the bill reference waits too.
    const d = await customer("Mehta"), e = await customer("Naik");
    const sd = await creditBill(d, 7);
    await creditBill(e, 7);
    await receiveFromCustomer(await ctxFor(), { partyId: e, amount: "700", method: "UPI", ref: "" });
    expect(await upload([[`UPI-MEHTA-m@ok-H-430555555555-${medoroRef(sd.invoiceNo)}`, "700.00"], ["UPI-NAIK-n@ok-H-430566666666-PAY", "700.00"]])).toMatchObject({ matched: 0, billsMatched: 0 });
    const ref = (await billMatching(await ctxFor())).suggested.find((l) => l.description.includes("MEHTA"))!;
    expect(ref.suggestions[0]).toMatchObject({ targetId: sd.saleId, rule: 1, auto: false, bookWarning: true });
  });

  it("refuses wrong amounts, debits and lines already matched; undo reverses the receipt and reopens the bill", async () => {
    const c = await customer("Joshi");
    const s = await creditBill(c, 3);
    await upload([["NEFT FROM JOSHI", "500.00"], ["CHARGES", "-10.00"]]);
    const lines = await db.bankLine.findMany({ orderBy: { amountPaise: "desc" } });
    const credit = lines.find((l) => l.amountPaise > 0n)!;
    await expect(allocateBill(await ctxFor(), { bankLineId: credit.id, saleId: s.saleId, amountPaise: 40000 })).rejects.toThrow(/only ₹300.00 left/);
    await expect(allocateBill(await ctxFor(), { bankLineId: credit.id, saleId: s.saleId, amountPaise: 60000 })).rejects.toThrow(/Only ₹500.00/);
    await allocateBill(await ctxFor(), { bankLineId: credit.id, saleId: s.saleId, amountPaise: 30000 });
    const tenantId = (await ctxFor()).tenantId;
    expect(await customerBalance(db, tenantId, c)).toBe(0);
    await expect(matchBankLine(await ctxFor(), credit.id, "x")).rejects.toThrow(/paid credit bills/);
    const a = await db.bankAllocation.findFirstOrThrow({ where: { bankLineId: credit.id } });
    await unallocateBill(await ctxFor(), a.id);
    expect(await customerBalance(db, tenantId, c)).toBe(30000);
    await expect(unallocateBill(await ctxFor(), a.id)).rejects.toThrow(/already undone/);
    expect((await bankReconciliation(await ctxFor())).statement.map((l) => l.id)).toContain(credit.id); // open again
    await expect(db.bankAllocation.update({ where: { id: a.id }, data: { kind: "manual" } })).rejects.toThrow(/append-only/);
  });

  it("read-only support sessions and Drive pharmacies can't post receipts", async () => {
    const ro = { ...(await ctxFor()), readOnly: true };
    await expect(allocateBill(ro, { bankLineId: "x", saleId: "y", amountPaise: 100 })).rejects.toThrow(/read-only/);
    const moved = { ...(await ctxFor()), moved: true };
    await expect(allocateBill(moved, { bankLineId: "x", saleId: "y", amountPaise: 100 })).rejects.toThrow(/Google Drive/);
  });
});
