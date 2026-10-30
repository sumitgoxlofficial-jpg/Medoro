import "server-only";
import { db } from "@/server/db";
import { authorizeAny, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { big } from "@/lib/money";
import { dayRange, periodOf } from "@/domain/accounting/service";
import { ACC } from "@/domain/accounting/accounts";
import { phoneMasker } from "@/domain/system/strict";

export type PartyType = "supplier" | "customer";

const KIND: Record<string, string> = { purchase: "Bill", debit_note: "Debit note", payment: "Payment", sales: "Credit sale", credit_note: "Credit note", receipt: "Receipt", reversal: "Reversal", journal: "Journal" };

/**
 * A party's ledger statement between two IST dates (inclusive): opening balance, every posting on their
 * control account (bills, credit sales, payments, receipts, debit/credit notes, reversals) and the closing
 * balance. Balance is what they owe us (customer) or what we owe them (supplier).
 */
export async function partyStatement(ctx: Ctx, type: PartyType, id: string, fromDay?: string, toDay?: string) {
  if (type === "supplier") authorizeAny(ctx, "payments", "purchase", "reports");
  else authorizeAny(ctx, "payments", "reports");
  const party = type === "supplier"
    ? await db.supplier.findFirst({ where: { id, tenantId: ctx.tenantId }, select: { id: true, name: true, gstin: true, phone: true } })
    : await db.customer.findFirst({ where: { id, tenantId: ctx.tenantId, erasedAt: null }, select: { id: true, name: true, phone: true } });
  if (!party) throw new UserError(type === "supplier" ? "Supplier not found." : "Customer not found.");
  const p = periodOf("fy");
  const r = dayRange(fromDay, toDay, p);
  const account = type === "supplier" ? ACC.creditors : ACC.debtors, sign = type === "supplier" ? -1 : 1;
  const [open, lines] = await Promise.all([
    db.$queryRaw<{ bal: bigint | null }[]>`
      SELECT SUM(l."debitPaise" - l."creditPaise") bal FROM "LedgerLine" l JOIN "Voucher" v ON v.id = l."voucherId"
      WHERE v."tenantId" = ${ctx.tenantId} AND l.account = ${account} AND l."partyType" = ${type} AND l."partyId" = ${id} AND v.date < ${r.from}`,
    db.ledgerLine.findMany({ where: { account, partyType: type, partyId: id, voucher: { tenantId: ctx.tenantId, date: { gte: r.from, lt: r.to } } }, include: { voucher: true }, orderBy: [{ voucher: { date: "asc" } }, { voucher: { no: "asc" } }] }),
  ]);
  const opening = sign * Number(open[0]?.bal ?? 0) || 0;
  let bal = opening, debit = 0, credit = 0;
  const rows = lines.map((l) => {
    const dr = big(l.debitPaise), cr = big(l.creditPaise);
    bal += sign * (dr - cr); debit += dr; credit += cr;
    const v = l.voucher;
    return { id: l.id, date: v.date.toISOString(), no: v.no, kind: v.refType === "opening" ? "Opening balance" : KIND[v.type] ?? v.type, narration: v.narration, debit: dr, credit: cr, balance: bal };
  });
  return {
    type, party: { id: party.id, name: party.name, gstin: "gstin" in party ? party.gstin : null, phone: type === "customer" ? (await phoneMasker(ctx))(party.phone) : party.phone },
    fromDay: r.fromDay, toDay: r.toDay, opening, rows, debit, credit, closing: bal,
  };
}

export function statementCsv(s: Awaited<ReturnType<typeof partyStatement>>) {
  const r2 = (p: number) => (p / 100).toFixed(2);
  const ist = (d: string) => new Date(new Date(d).getTime() + 330 * 60_000).toISOString().slice(0, 10);
  return [
    ["Date", "Voucher", "Type", "Particulars", "Debit", "Credit", "Balance"],
    [s.fromDay, "", "", "Opening balance", "", "", r2(s.opening)],
    ...s.rows.map((x) => [ist(x.date), x.no, x.kind, x.narration, r2(x.debit), r2(x.credit), r2(x.balance)]),
    [s.toDay, "", "", "Closing balance", r2(s.debit), r2(s.credit), r2(s.closing)],
  ];
}
