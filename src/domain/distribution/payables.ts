import "server-only";
import { db } from "@/server/db";
import type { Ctx } from "@/server/context";
import { isoOf } from "@/lib/dates";
import { ACC } from "@/domain/accounting/accounts";
import { supplierBalances } from "@/domain/parties/balances";
import { distView } from "./context";
import { num } from "./common";

/** What the distributor owes each supplier (credit balance on Sundry creditors), with the latest purchase and payment. */
export async function payables(ctx: Ctx) {
  distView(ctx, "purchase", "payments", "reports");
  const [suppliers, bal, last] = await Promise.all([
    db.supplier.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { name: "asc" } }),
    supplierBalances(db, ctx.tenantId),
    db.$queryRaw<{ id: string; bought: Date | null; paid: Date | null }[]>`
      SELECT l."partyId" id, MAX(v.date) FILTER (WHERE l."creditPaise" > 0) bought, MAX(v.date) FILTER (WHERE l."debitPaise" > 0) paid
      FROM "LedgerLine" l JOIN "Voucher" v ON v.id = l."voucherId"
      WHERE v."tenantId" = ${ctx.tenantId} AND l.account = ${ACC.creditors} AND l."partyType" = 'supplier' GROUP BY l."partyId"`,
  ]);
  return suppliers.map((s) => {
    const l = last.find((x) => x.id === s.id);
    return { ...s, balance: bal.get(s.id) ?? 0, lastPurchase: l?.bought ? isoOf(l.bought) : null, lastPayment: l?.paid ? isoOf(l.paid) : null };
  });
}

/** Supplier ledger statement from the books: purchases (credit), payments, debit notes and claim credits (debit), running balance we owe. */
export async function supplierStatement(ctx: Ctx, supplierId: string, from?: string, to?: string) {
  distView(ctx, "purchase", "payments", "reports");
  const lines = await db.ledgerLine.findMany({
    where: { account: ACC.creditors, partyType: "supplier", partyId: supplierId, voucher: { tenantId: ctx.tenantId } },
    include: { voucher: true }, orderBy: [{ voucher: { date: "asc" } }, { voucher: { no: "asc" } }],
  });
  let run = 0, opening = 0;
  const rows: { date: string; no: string; narration: string; dr: number; cr: number; balance: number }[] = [];
  for (const l of lines) {
    const d = isoOf(l.voucher.date), amt = num(l.creditPaise) - num(l.debitPaise);
    if (from && d < from) { opening += amt; run += amt; continue; }
    if (to && d > to) continue;
    run += amt;
    rows.push({ date: d, no: l.voucher.no, narration: l.voucher.narration, dr: num(l.debitPaise), cr: num(l.creditPaise), balance: run });
  }
  return { opening, rows, closing: run };
}
