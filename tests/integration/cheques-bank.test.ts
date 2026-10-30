import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { listCustomers, listSuppliers, paySupplier, receiveFromCustomer, saveCustomer, saveSupplier } from "@/domain/parties/service";
import { bounceCheque, clearCheque, depositCheque, dueCheques, listCheques } from "@/domain/parties/cheques";
import { reverseVoucher } from "@/domain/accounting/service";
import { bankReconciliation, importBankStatement, matchBankLine, unmatchBankLine } from "@/domain/accounting/bank";
import { ACC } from "@/domain/accounting/accounts";
import { addDays, todayISO } from "@/lib/dates";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

async function bal(account: string) {
  const r = await db.ledgerLine.aggregate({ where: { account }, _sum: { debitPaise: true, creditPaise: true } });
  return Number((r._sum.debitPaise ?? 0n) - (r._sum.creditPaise ?? 0n));
}
const ddmm = (iso: string) => iso.split("-").reverse().join("/");
let cus = "", sup = "";

describe("cheques and bank reconciliation", () => {
  beforeAll(async () => {
    await resetDb(); await makePharmacy();
    const ctx = await ctxFor();
    cus = await saveCustomer(ctx, null, { name: "Pawar Clinic", phone: "9823077015", waOptIn: false, creditLimit: "50000", opening: "10000" });
    sup = await saveSupplier(ctx, null, { name: "Pune Pharma", creditDays: "21", opening: "5000" });
  });

  it("customer cheques: post-dated, deposit, clear, bounce with charges", async () => {
    const ctx = await ctxFor();
    const pdc = { partyId: cus, amount: "4000", method: "Cheque" as const, chequeNo: "123456", bank: "HDFC Bank", chequeDate: addDays(todayISO(), 5) };
    await expect(receiveFromCustomer(ctx, { ...pdc, chequeNo: "12AB" })).rejects.toThrow(/6 digits/);
    await expect(receiveFromCustomer(ctx, { ...pdc, chequeDate: addDays(todayISO(), -120) })).rejects.toThrow(/stale/);
    await receiveFromCustomer(ctx, pdc);
    await expect(receiveFromCustomer(ctx, { ...pdc, amount: "1" })).rejects.toThrow(/already recorded/);
    expect(await bal(ACC.chequesInHand)).toBe(400000);
    expect((await listCustomers(ctx)).find((c) => c.id === cus)!.due).toBe(600000);
    await receiveFromCustomer(ctx, { ...pdc, chequeNo: "123457", amount: "3000", chequeDate: todayISO() });
    const [post, now] = await listCheques(ctx).then((r) => [r.find((c) => c.no === "123456")!, r.find((c) => c.no === "123457")!]);
    expect((await dueCheques(ctx)).map((c) => c.no)).toEqual(["123457"]);
    await expect(depositCheque(ctx, post.id)).rejects.toThrow(/post-dated/);
    await expect(clearCheque(ctx, now.id)).rejects.toThrow(/Deposit cheque 123457 first/);
    await depositCheque(ctx, now.id);
    await clearCheque(ctx, now.id);
    expect([await bal(ACC.bank), await bal(ACC.chequesInHand)]).toEqual([300000, 400000]);
    await expect(clearCheque(ctx, now.id)).rejects.toThrow(/cleared/);
    const rv = await db.voucher.findFirstOrThrow({ where: { refType: "cheque_receipt" } });
    await expect(reverseVoucher(ctx, rv.id, "mistake")).rejects.toThrow(/not reversals/);
    await bounceCheque(ctx, post.id, { reason: "Funds insufficient", charge: "200", bankCharge: "100" });
    expect((await listCustomers(ctx)).find((c) => c.id === cus)!.due).toBe(300000 + 400000 + 20000);
    expect([await bal(ACC.chequesInHand), await bal(ACC.bankCharges), await bal(ACC.bank)]).toEqual([0, -10000, 290000]);
    await expect(bounceCheque(ctx, post.id, { reason: "again" })).rejects.toThrow(/bounced/);
    const audit = await db.auditEvent.findMany({ where: { entity: "cheque" }, select: { action: true }, orderBy: { id: "asc" } });
    expect(audit.map((a) => a.action.split(" ").slice(0, 2).join(" "))).toEqual(["Cheque deposited", "Cheque cleared", "Cheque bounced"]);
  });

  it("supplier cheques: bills settle on issue, reopen on bounce, bank moves on clearing", async () => {
    const ctx = await ctxFor();
    const chq = { partyId: sup, method: "Cheque" as const, bank: "SBI current a/c", chequeDate: todayISO() };
    await paySupplier(ctx, { ...chq, amount: "2000", chequeNo: "000771" });
    expect(await bal(ACC.chequesIssued)).toBe(-200000);
    let bill = await db.supplierBill.findFirstOrThrow({ where: { supplierId: sup } });
    expect(bill.paidPaise).toBe(200000n);
    const c1 = (await listCheques(ctx)).find((c) => c.no === "000771")!;
    await expect(depositCheque(ctx, c1.id)).rejects.toThrow(/received/);
    await bounceCheque(ctx, c1.id, { reason: "Signature differs", charge: "50" });
    bill = await db.supplierBill.findFirstOrThrow({ where: { supplierId: sup, ref: "Opening balance" } });
    expect(bill.paidPaise).toBe(0n);
    expect((await listSuppliers(ctx)).find((s) => s.id === sup)!.balance).toBe(505000);
    expect(await bal(ACC.chequesIssued)).toBe(0);
    await paySupplier(ctx, { ...chq, amount: "1000", chequeNo: "000777" });
    const c2 = (await listCheques(ctx)).find((c) => c.no === "000777")!;
    await clearCheque(ctx, c2.id);
    expect([await bal(ACC.chequesIssued), await bal(ACC.bank)]).toEqual([0, 290000 - 100000]);
  });

  it("bank statement import auto-matches by amount, date and reference; manual match and unmatch", async () => {
    const ctx = await ctxFor();
    await paySupplier(ctx, { partyId: sup, amount: "500", method: "Bank transfer (NEFT)", ref: "UTR8812345678" });
    const d = ddmm(todayISO());
    const csv = [
      "Statement of account XXXX1234,,,,,",
      "Date,Narration,Chq/Ref No,Withdrawal,Deposit,Balance",
      `${d},CLG CHQ DEP 123457 PAWAR CLINIC,123457,,"3,000.00","3,000.00"`,
      `${d},ATM WDL,,"1,000.00",,"2,000.00"`,
      `${d},CHQ PAID 000777 PUNE PHARMA,000777,"1,000.00",,"1,000.00"`,
      `${d},CHQ RETURN CHARGES,,100.00,,900.00`,
      `${d},NEFT-UTR8812345678-PUNE PHARMA,UTR8812345678,500.00,,400.00`,
      `${d},INTEREST CREDIT,,,9.99,409.99`,
    ].join("\n");
    const r = await importBankStatement(ctx, "hdfc.csv", new TextEncoder().encode(csv));
    if (r.needsMapping) throw new Error("expected header detection");
    expect([r.imported, r.matched]).toEqual([6, 4]);
    let rec = await bankReconciliation(ctx);
    expect(rec.statement.map((s) => s.description).sort()).toEqual(["ATM WDL", "INTEREST CREDIT"]);
    expect(rec.books).toEqual([]);
    expect(rec.balance).toMatchObject({ bank: 40999, books: 290000 - 100000 - 50000 });
    const atm = rec.statement.find((s) => s.description === "ATM WDL")!;
    expect(atm.candidates).toEqual([]);
    const again = await importBankStatement(ctx, "hdfc.csv", new TextEncoder().encode(csv));
    expect(again).toMatchObject({ imported: 0, duplicates: 6 });
    const auto = rec.recent.find((x) => x.voucherNo.startsWith("JV") && x.amount === -100000)!;
    expect(auto.matchedBy).toBe("auto");
    await unmatchBankLine(ctx, auto.id);
    rec = await bankReconciliation(ctx);
    const back = rec.statement.find((s) => s.id === auto.id)!;
    expect(back.candidates).toHaveLength(1);
    await matchBankLine(ctx, atm.id, back.candidates[0].id);
    await expect(matchBankLine(ctx, auto.id, back.candidates[0].id)).rejects.toThrow(/already matched/);
    const interest = rec.statement.find((s) => s.description === "INTEREST CREDIT")!;
    await expect(matchBankLine(ctx, interest.id, back.candidates[0].id)).rejects.toThrow(/Amounts differ/);
  });
});
