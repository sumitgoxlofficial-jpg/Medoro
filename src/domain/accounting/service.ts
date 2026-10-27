import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorize, authorizeAny, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { addDays, istDate, todayISO } from "@/lib/dates";
import { big, inr } from "@/lib/money";
import { postVoucher } from "./post";
import { ACC, EXPENSE_ACCOUNTS } from "./accounts";

export type Period = { from: Date; to: Date; label: string; key: string; fromDay: string; toDay: string }; // toDay is exclusive
const IST = 330 * 60_000;

/** "month" (default), "last", "fy" or "YYYY-MM". Boundaries are IST midnights. */
export function periodOf(key: string | undefined): Period {
  const t = todayISO();
  const [y, m] = t.split("-").map(Number);
  const start = (yy: number, mm: number) => new Date(Date.UTC(yy, mm - 1, 1) - IST);
  const fmt = (d: Date) => new Date(d.getTime() + IST).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const now = new Date();
  let from: Date, to: Date, k = key ?? "month";
  if (k === "last") { from = start(m === 1 ? y - 1 : y, m === 1 ? 12 : m - 1); to = start(y, m); }
  else if (k === "fy") { const fy = m >= 4 ? y : y - 1; from = start(fy, 4); to = now; }
  else if (/^\d{4}-\d{2}$/.test(k)) { const [a, b] = k.split("-").map(Number); from = start(a, b); to = new Date(Math.min(start(b === 12 ? a + 1 : a, b === 12 ? 1 : b + 1).getTime(), now.getTime())); }
  else { k = "month"; from = start(y, m); to = now; }
  return { from, to, key: k, label: `${fmt(from)} – ${fmt(new Date(to.getTime() - 1))}`, fromDay: istDate(from), toDay: addDays(istDate(new Date(to.getTime() - 1)), 1) };
}

async function accountTotals(tenantId: string, from: Date | null, to: Date) {
  const rows = await db.$queryRaw<{ account: string; dr: bigint; cr: bigint }[]>`
    SELECT l.account, SUM(l."debitPaise") dr, SUM(l."creditPaise") cr FROM "LedgerLine" l JOIN "Voucher" v ON v.id = l."voucherId"
    WHERE v."tenantId" = ${tenantId} AND v.date < ${to} AND (${from}::timestamptz IS NULL OR v.date >= ${from}) GROUP BY l.account`;
  return new Map(rows.map((r) => [r.account, { dr: Number(r.dr), cr: Number(r.cr) }]));
}

export async function accountsOverview(ctx: Ctx, p: Period) {
  authorize(ctx, "reports");
  const [tot, all, cogsRows, gstOut, gstIn] = await Promise.all([
    accountTotals(ctx.tenantId, p.from, p.to),
    accountTotals(ctx.tenantId, null, new Date()),
    db.$queryRaw<{ c: bigint | null }[]>`SELECT SUM(si."costPaise" * (si.qty - si."returnedQty")) c FROM "SaleItem" si JOIN "Sale" s ON s.id = si."saleId" WHERE s."tenantId" = ${ctx.tenantId} AND s.at >= ${p.from} AND s.at < ${p.to}`,
    db.$queryRaw<{ rate: number; taxable: bigint; tax: bigint }[]>`
      SELECT si."gstRate" rate, SUM(si."taxablePaise") taxable, SUM(si."mrpPaise" * si.qty - si."discountPaise" - si."taxablePaise") tax
      FROM "SaleItem" si JOIN "Sale" s ON s.id = si."saleId" WHERE s."tenantId" = ${ctx.tenantId} AND s.at >= ${p.from} AND s.at < ${p.to} GROUP BY 1 ORDER BY 1`,
    db.$queryRaw<{ rate: number; taxable: bigint }[]>`
      SELECT gi."gstRate" rate, SUM(gi."ratePaise" * gi.qty) taxable FROM "GrnItem" gi JOIN "Grn" g ON g.id = gi."grnId"
      WHERE g."tenantId" = ${ctx.tenantId} AND g."invoiceDate" >= ${p.fromDay}::date AND g."invoiceDate" < ${p.toDay}::date GROUP BY 1 ORDER BY 1`,
  ]);
  const cr = (a: string) => (tot.get(a)?.cr ?? 0) - (tot.get(a)?.dr ?? 0);
  const dr = (a: string) => -cr(a);
  const sales = cr(ACC.sales) - dr(ACC.salesReturns);
  const cogs = Number(cogsRows[0]?.c ?? 0);
  const expenseLines = [...EXPENSE_ACCOUNTS, ACC.stockLoss, ACC.cashDiff, ACC.roundOff].map((a) => ({ account: a, amount: dr(a) })).filter((x) => x.amount !== 0);
  const expenses = expenseLines.reduce((a, x) => a + x.amount, 0);
  const bal = (a: string) => (all.get(a)?.dr ?? 0) - (all.get(a)?.cr ?? 0);
  const rates = [...new Set([...gstOut.map((g) => g.rate), ...gstIn.map((g) => g.rate)])].sort((a, b) => a - b);
  const retTax = dr(ACC.cgst) + dr(ACC.sgst); // output tax reversed by credit notes is posted as debits
  const gst = rates.map((r) => {
    const o = gstOut.find((g) => g.rate === r), i = gstIn.find((g) => g.rate === r);
    const out = Number(o?.tax ?? 0), inTaxable = Number(i?.taxable ?? 0), inTax = Math.round((inTaxable * r) / 100);
    return { rate: r, outTaxable: Number(o?.taxable ?? 0), outTax: out, inTaxable, inTax };
  });
  return {
    period: p,
    pl: { sales, cogs, gross: sales - cogs, expenseLines, expenses, net: sales - cogs - expenses },
    cash: { cash: bal(ACC.cash), bank: bal(ACC.bank), receivable: bal(ACC.debtors), payable: -bal(ACC.creditors) },
    gst, gstTotals: { out: cr(ACC.cgst) + cr(ACC.sgst), returnsReversed: retTax, in: dr(ACC.inCgst) + dr(ACC.inSgst) },
  };
}

export async function dayBook(ctx: Ctx, p: Period, take = 100) {
  authorizeAny(ctx, "reports", "payments");
  const vs = await db.voucher.findMany({ where: { tenantId: ctx.tenantId, date: { gte: p.from, lt: p.to } }, include: { lines: true }, orderBy: [{ date: "desc" }, { no: "desc" }], take });
  const reversed = new Set((await db.voucher.findMany({ where: { tenantId: ctx.tenantId, reversesId: { in: vs.map((v) => v.id) } }, select: { reversesId: true } })).map((r) => r.reversesId));
  return vs.map((v) => ({
    id: v.id, no: v.no, date: v.date.toISOString(), type: v.type, narration: v.narration,
    dr: [...new Set(v.lines.filter((l) => l.debitPaise > 0n).map((l) => l.account))].join(", "),
    cr: [...new Set(v.lines.filter((l) => l.creditPaise > 0n).map((l) => l.account))].join(", "),
    amount: v.lines.reduce((a, l) => a + big(l.debitPaise), 0),
    reversed: reversed.has(v.id), isReversal: !!v.reversesId,
    canReverse: !v.reversesId && !reversed.has(v.id) && ["expense", "supplier_payment", "customer_receipt", "manual"].includes(v.refType ?? ""),
  }));
}

export const expenseSchema = z.object({
  account: z.enum(EXPENSE_ACCOUNTS),
  amount: z.union([z.string(), z.number()]).transform((v) => Math.round((parseFloat(String(v)) || 0) * 100)).refine((p) => p > 0, "Enter an amount."),
  method: z.enum(["Cash", "Bank", "UPI"]),
  note: z.string().trim().max(120).default(""),
});

export async function recordExpense(ctx: Ctx, raw: z.input<typeof expenseSchema>) {
  authorize(ctx, "payments");
  const i = expenseSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const v = await postVoucher(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, type: "payment", userId: ctx.userId, refType: "expense", narration: `${i.account}${i.note ? " · " + i.note : ""} · ${i.method}`,
      lines: [{ account: i.account, dr: i.amount }, { account: i.method === "Cash" ? ACC.cash : ACC.bank, cr: i.amount }] });
    await writeAudit(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: `Expense posted ${v.no}`, entity: "voucher", entityId: v.id, detail: `${i.account} · ${inr(i.amount)} · ${i.method}` });
    return v.no;
  });
}

/** Reverses a manual voucher with a mirror entry. The original stays for audit. */
export async function reverseVoucher(ctx: Ctx, id: string, reason: string) {
  authorize(ctx, "payments");
  if (reason.trim().length < 3) throw new UserError("Enter a reason for the reversal.");
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"rev:" + id}))`;
    const v = await tx.voucher.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { lines: true } });
    if (!v) throw new UserError("Voucher not found.");
    if (v.reversesId || (await tx.voucher.findFirst({ where: { reversesId: v.id } }))) throw new UserError("This entry is already reversed.");
    if (!["expense", "supplier_payment", "customer_receipt", "manual"].includes(v.refType ?? "")) throw new UserError("Sales, purchases and credit notes are corrected with returns or debit notes, not reversals.");
    const r = await postVoucher(tx, { tenantId: ctx.tenantId, branchId: v.branchId, type: "reversal", userId: ctx.userId, refType: "reversal", refId: v.id, reversesId: v.id,
      narration: `Reversal of ${v.no} · ${reason.trim()}`,
      lines: v.lines.map((l) => ({ account: l.account, dr: big(l.creditPaise), cr: big(l.debitPaise), partyType: (l.partyType ?? undefined) as "supplier" | undefined, partyId: l.partyId ?? undefined })) });
    if (v.refType === "supplier_payment") {
      // Undo the payment's allocation, newest bills first.
      let left = v.lines.reduce((a, l) => a + big(l.debitPaise), 0);
      for (const b of await tx.supplierBill.findMany({ where: { tenantId: ctx.tenantId, supplierId: v.refId!, paidPaise: { gt: 0n } }, orderBy: [{ dueDate: "desc" }] })) {
        if (left <= 0) break;
        const take = Math.min(big(b.paidPaise), left);
        await tx.supplierBill.update({ where: { id: b.id }, data: { paidPaise: { decrement: BigInt(take) } } });
        left -= take;
      }
    }
    await writeAudit(tx, { tenantId: ctx.tenantId, branchId: v.branchId, userId: ctx.userId, userName: ctx.userName, action: "Entry reversed", entity: "voucher", entityId: v.id, detail: `${v.no} → ${r.no} · ${reason.trim()}` });
    return r.no;
  });
}

