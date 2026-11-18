import "server-only";
import { db } from "@/server/db";
import type { Ctx } from "@/server/context";
import { isoOf, todayISO } from "@/lib/dates";
import { customerBalances } from "@/domain/parties/balances";
import { distView } from "./context";
import { num } from "./common";
import { ageing, AGE_BUCKETS, openBills, type AgeBucket, type OpenBill } from "./rules/ageing";
import { creditRisk } from "./rules/analytics";

/** Bill-wise outstanding and ageing for every chemist (FIFO against the ledger balance). */
export async function receivables(ctx: Ctx, opts: { salesmanId?: string; territoryId?: string } = {}) {
  distView(ctx, "payments", "reports", "approve", "order");
  const today = todayISO();
  const chems = await db.distChemist.findMany({ where: { tenantId: ctx.tenantId, ...(opts.salesmanId ? { salesmanId: opts.salesmanId } : {}), ...(opts.territoryId ? { territoryId: opts.territoryId } : {}) } });
  const ids = chems.map((c) => c.customerId);
  const [bal, custs, invs, cancels, bounces, paid90, billed90] = await Promise.all([
    customerBalances(db, ctx.tenantId),
    db.customer.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, phone: true, creditLimitPaise: true } }),
    db.distInvoice.findMany({ where: { tenantId: ctx.tenantId, customerId: { in: ids } }, select: { id: true, no: true, date: true, dueDate: true, totalPaise: true, customerId: true }, orderBy: { date: "desc" } }),
    db.distInvoiceCancel.findMany({ where: { tenantId: ctx.tenantId }, select: { invoiceId: true } }),
    db.cheque.groupBy({ by: ["partyId"], where: { tenantId: ctx.tenantId, partyType: "customer", status: "bounced", bouncedAt: { gte: new Date(Date.now() - 90 * 86400000) } }, _count: true }),
    db.$queryRaw<{ id: string; v: bigint }[]>`SELECT l."partyId" id, SUM(l."creditPaise")::bigint v FROM "LedgerLine" l JOIN "Voucher" v ON v.id = l."voucherId" WHERE v."tenantId" = ${ctx.tenantId} AND v.type = 'receipt' AND l."partyType" = 'customer' AND v.date >= now() - interval '90 days' GROUP BY 1`,
    db.distInvoice.groupBy({ by: ["customerId"], where: { tenantId: ctx.tenantId, at: { gte: new Date(Date.now() - 90 * 86400000) } }, _sum: { totalPaise: true } }),
  ]);
  const cx = new Set(cancels.map((c) => c.invoiceId));
  return chems.map((ch) => {
    const c = custs.find((x) => x.id === ch.customerId);
    const balance = bal.get(ch.customerId) ?? 0;
    const bills = invs.filter((i) => i.customerId === ch.customerId && !cx.has(i.id)).map((i) => ({ id: i.id, no: i.no, date: isoOf(i.date), dueDate: isoOf(i.dueDate), total: num(i.totalPaise) }));
    const open = openBills(bills, balance, today);
    const overdue = open.filter((b) => b.overdueDays > 0).reduce((a, b) => a + b.open, 0);
    const oldest = open.filter((b) => b.id !== "opening")[0];
    const risk = creditRisk({ limit: num(c?.creditLimitPaise), balance, overdue, oldestDays: oldest?.ageDays ?? 0, creditDays: ch.creditDays, bounces90d: bounces.find((b) => b.partyId === ch.customerId)?._count ?? 0, paidLast90: num(paid90.find((p) => p.id === ch.customerId)?.v), billedLast90: num(billed90.find((b) => b.customerId === ch.customerId)?._sum.totalPaise) });
    return { customerId: ch.customerId, name: c?.name ?? "—", phone: c?.phone ?? null, limit: num(c?.creditLimitPaise), creditDays: ch.creditDays, status: ch.status, salesmanId: ch.salesmanId, territoryId: ch.territoryId, balance, overdue, oldestDays: oldest?.ageDays ?? 0, buckets: ageing(open), open, risk };
  }).sort((a, b) => b.balance - a.balance);
}

export type ReceivableRow = Awaited<ReturnType<typeof receivables>>[number];

export function ageingTotals(rows: { buckets: Record<AgeBucket, number> }[]) {
  const t = Object.fromEntries(AGE_BUCKETS.map((b) => [b, 0])) as Record<AgeBucket, number>;
  for (const r of rows) for (const b of AGE_BUCKETS) t[b] += r.buckets[b];
  return t;
}

/** Ledger statement for a chemist: every voucher line on Sundry debtors with a running balance. */
export async function chemistStatement(ctx: Ctx, customerId: string, from?: string, to?: string) {
  distView(ctx, "payments", "reports", "order");
  const lines = await db.ledgerLine.findMany({
    where: { account: "Sundry debtors", partyType: "customer", partyId: customerId, voucher: { tenantId: ctx.tenantId } },
    include: { voucher: true }, orderBy: [{ voucher: { date: "asc" } }, { voucher: { no: "asc" } }],
  });
  let run = 0, opening = 0;
  const rows: { date: string; no: string; narration: string; dr: number; cr: number; balance: number }[] = [];
  for (const l of lines) {
    const d = isoOf(l.voucher.date), amt = num(l.debitPaise) - num(l.creditPaise);
    if (from && d < from) { opening += amt; run += amt; continue; }
    if (to && d > to) continue;
    run += amt;
    rows.push({ date: d, no: l.voucher.no, narration: l.voucher.narration, dr: num(l.debitPaise), cr: num(l.creditPaise), balance: run });
  }
  return { opening, rows, closing: run };
}

export type { OpenBill };
