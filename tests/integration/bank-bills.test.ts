import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { createMedicine, receiveBatch } from "@/domain/inventory/service";
import { commitSale } from "@/domain/sales/service";
import { receiveFromCustomer, saveCustomer } from "@/domain/parties/service";
import { customerBalances } from "@/domain/parties/balances";
import { bankReconciliation, importBankStatement, unmatchBankLine } from "@/domain/accounting/bank";
import { matchBankLineToBill, openCreditBills, rejectBillSuggestion } from "@/domain/accounting/bank-bills";
import { medoroRef } from "@/domain/finance/match";
import { addDays, todayISO } from "@/lib/dates";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

const ddmm = (iso: string) => iso.split("-").reverse().join("/");
const key = () => "k_" + randomUUID().replace(/-/g, "");

describe("bank credits matched to credit bills on the server", () => {
  let pawar = "", kale = "", bill1 = { saleId: "", invoiceNo: "" }, bill3 = { saleId: "", invoiceNo: "" }, bill2 = "";
  beforeAll(async () => {
    await resetDb(); await makePharmacy();
    const ctx = await ctxFor();
    const med = await createMedicine(ctx, { name: "Pan 40", generic: "Pantoprazole", strength: "40 mg", form: "Tablet", manufacturer: "Alkem", pack: "15", mrp: "155", gstRate: 12, schedule: "", reorderLevel: 5, barcode: "", hsn: "3004", rack: "" });
    await receiveBatch(ctx, { medicineId: med, batchNo: "P1", expiry: addDays(todayISO(), 300), qty: 100, cost: "100", mrp: "155", supplierId: null, invoiceNo: "" });
    const batch = (await db.batch.findFirstOrThrow()).id;
    pawar = await saveCustomer(ctx, null, { name: "Pawar Clinic", phone: "9823077015", waOptIn: false, creditLimit: "50000", opening: "0" });
    kale = await saveCustomer(ctx, null, { name: "Kale Traders", phone: "9823077016", waOptIn: false, creditLimit: "50000", opening: "0" });
    const credit = (customerId: string, qty: number) => commitSale(ctx, { idempotencyKey: key(), lines: [{ medicineId: med, batchId: batch, qty }], customerId, discountPct: 0, pay: { mode: "credit" } } as Parameters<typeof commitSale>[1]);
    bill1 = await credit(pawar, 10); // 1,550
    bill2 = (await credit(pawar, 2)).saleId; // 310
    bill3 = await credit(kale, 2); // 310
    await receiveFromCustomer(ctx, { partyId: kale, amount: "100", method: "UPI", ref: "UPI 498765432101" }); // already in the books
  });

  it("works out each bill's open amount from the customer's balance, oldest paid first", async () => {
    const ctx = await ctxFor();
    const open = await openCreditBills(db, ctx.tenantId);
    expect(open.find((b) => b.saleId === bill1.saleId)?.balancePaise).toBe(155000);
    expect(open.find((b) => b.saleId === bill3.saleId)?.balancePaise).toBe(21000); // 310 billed, 100 received
  });

  it("matches a credit carrying Medoro's reference automatically, and only suggests by amount", async () => {
    const ctx = await ctxFor();
    const d = ddmm(todayISO());
    const csv = [
      "Date,Narration,Chq/Ref No,Withdrawal,Deposit,Balance",
      `${d},UPI/412345678901/${medoroRef(bill1.invoiceNo)}/pawar@okaxis,,,"1,550.00","1,550.00"`,
      `${d},UPI/498765432101/kale@okicici,,,100.00,"1,650.00"`,
      `${d},NEFT-N123456789-KALE TRADERS,,,210.00,"1,860.00"`,
      `${d},UPI/411111111111/someone@ybl,,,"9,999.00","11,859.00"`,
    ].join("\n");
    const r = await importBankStatement(ctx, "hdfc.csv", new TextEncoder().encode(csv));
    if (r.needsMapping) throw new Error("expected header detection");
    expect(r).toMatchObject({ imported: 4, bills: 1, matched: 2 }); // the 100 is the receipt already in the books
    const bal = await customerBalances(db, ctx.tenantId);
    expect(bal.get(pawar)).toBe(31000); // bill 1 paid; bill 2 still open
    const rec = await bankReconciliation(ctx);
    expect(rec.recent.find((x) => x.amount === 155000)).toMatchObject({ matchedBy: "bill-auto", bill: bill1.invoiceNo });
    const kaleLine = rec.statement.find((s) => s.amount === 21000)!;
    expect(kaleLine.bills.map((b) => b.saleId)).toEqual([bill3.saleId]);
    expect(kaleLine.bills[0].rule).toBe(4); // only bill of that amount: a suggestion, never automatic
    expect(rec.statement.find((s) => s.amount === 999900)!.bills).toEqual([]);
    expect(await db.voucher.count({ where: { tenantId: ctx.tenantId, narration: { contains: "for " + bill1.invoiceNo } } })).toBe(1);
  });

  it("approve posts the receipt and reconciles; not-this-one hides it; undo reverses the receipt", async () => {
    const ctx = await ctxFor();
    let rec = await bankReconciliation(ctx);
    const line = rec.statement.find((s) => s.amount === 21000)!;
    await rejectBillSuggestion(ctx, line.id, bill3.saleId);
    expect((await bankReconciliation(ctx)).statement.find((s) => s.id === line.id)!.bills).toEqual([]);
    await expect(matchBankLineToBill(ctx, rec.statement.find((s) => s.amount === 999900)!.id, bill2)).rejects.toThrow(/more than Pawar Clinic owes/);
    await matchBankLineToBill(ctx, line.id, bill3.saleId); // a person can still choose it
    expect((await customerBalances(db, ctx.tenantId)).get(kale) ?? 0).toBe(0);
    rec = await bankReconciliation(ctx);
    expect(rec.recent.find((x) => x.id === line.id)).toMatchObject({ matchedBy: "bill", bill: bill3.invoiceNo });
    await unmatchBankLine(ctx, line.id);
    expect((await customerBalances(db, ctx.tenantId)).get(kale)).toBe(21000);
    expect(await db.voucher.count({ where: { tenantId: ctx.tenantId, narration: { startsWith: "Reversal of" } } })).toBe(1);
    expect((await bankReconciliation(ctx)).statement.some((s) => s.id === line.id)).toBe(true);
    expect(await db.auditEvent.count({ where: { action: { in: ["Bank credit matched to a bill automatically", "Bank credit matched to a bill", "Bank bill match undone"] } } })).toBe(3);
  });
});
