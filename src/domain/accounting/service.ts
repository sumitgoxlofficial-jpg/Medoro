import "server-only";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorize, authorizeView, can, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { addDays, istDate, istMidnight, todayISO } from "@/lib/dates";
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

type GstRow = { rate: number; taxable: bigint; tax: bigint };
const inBranches = (col: Prisma.Sql, branchIds: string[] | null) => (branchIds ? Prisma.sql`AND ${col} = ANY(${branchIds}::text[])` : Prisma.empty);

/**
 * Output GST by slab for the period, net of credit notes (sales returns) issued in it, split the same way the
 * credit-note voucher splits them. `branchIds` null = the whole pharmacy.
 */
export async function outputGstByRate(tenantId: string, p: Period, branchIds: string[] | null) {
  const [sold, returned] = await Promise.all([
    db.$queryRaw<GstRow[]>`
      SELECT si."gstRate" rate, SUM(si."taxablePaise")::bigint taxable, SUM(si."mrpPaise" * si.qty - si."discountPaise" - si."taxablePaise")::bigint tax
      FROM "SaleItem" si JOIN "Sale" s ON s.id = si."saleId"
      WHERE s."tenantId" = ${tenantId} AND s.at >= ${p.from} AND s.at < ${p.to} AND NOT EXISTS (SELECT 1 FROM "SaleVoid" sv WHERE sv."saleId" = s.id) ${inBranches(Prisma.sql`s."branchId"`, branchIds)} GROUP BY 1`,
    db.$queryRaw<GstRow[]>`
      SELECT x.rate, SUM(x.taxable)::bigint taxable, SUM(x.amount - x.taxable)::bigint tax FROM (
        SELECT si."gstRate" rate, (l->>'amount')::bigint amount, ROUND(si."taxablePaise"::numeric * (l->>'qty')::int / si.qty) taxable
        FROM "SalesReturn" r CROSS JOIN LATERAL jsonb_array_elements(r.lines) l JOIN "SaleItem" si ON si.id = l->>'itemId'
        WHERE r."tenantId" = ${tenantId} AND r.at >= ${p.from} AND r.at < ${p.to} ${inBranches(Prisma.sql`r."branchId"`, branchIds)}) x GROUP BY 1`,
  ]);
  const rates = [...new Set([...sold, ...returned].map((r) => r.rate))].sort((a, b) => a - b);
  return rates.map((rate) => {
    const s = sold.find((r) => r.rate === rate), r = returned.find((x) => x.rate === rate);
    const grossTaxable = Number(s?.taxable ?? 0), grossTax = Number(s?.tax ?? 0), retTaxable = Number(r?.taxable ?? 0), retTax = Number(r?.tax ?? 0);
    return { rate, grossTaxable, grossTax, retTaxable, retTax, taxable: grossTaxable - retTaxable, tax: grossTax - retTax };
  });
}

/**
 * Input GST by slab for the period: purchase invoices dated in it, less debit notes raised in it. Purchase tax
 * is computed per line exactly as it was posted; debit-note tax is read from the posted input-tax ledger lines.
 * The slab totals therefore agree with the Input CGST/SGST/IGST ledgers.
 */
export async function inputGstByRate(tenantId: string, p: Period, branchIds: string[] | null) {
  const [bought, returned] = await Promise.all([
    db.$queryRaw<{ rate: number; igst: boolean; taxable: bigint; tax: bigint }[]>`
      SELECT gi."gstRate" rate, g.igst, SUM(gi."ratePaise" * gi.qty)::bigint taxable, SUM(ROUND((gi."ratePaise" * gi.qty * gi."gstRate")::numeric / 100))::bigint tax
      FROM "GrnItem" gi JOIN "Grn" g ON g.id = gi."grnId"
      WHERE g."tenantId" = ${tenantId} AND g."invoiceDate" >= ${p.fromDay}::date AND g."invoiceDate" < ${p.toDay}::date ${inBranches(Prisma.sql`g."branchId"`, branchIds)} GROUP BY 1, 2`,
    db.$queryRaw<{ rate: number; taxable: bigint; cs: bigint; ig: bigint }[]>`
      SELECT m."gstRate" rate,
        SUM(CASE WHEN l.account = ${ACC.purchases} THEN l."creditPaise" - l."debitPaise" ELSE 0 END)::bigint taxable,
        SUM(CASE WHEN l.account IN (${ACC.inCgst}, ${ACC.inSgst}) THEN l."creditPaise" - l."debitPaise" ELSE 0 END)::bigint cs,
        SUM(CASE WHEN l.account = ${ACC.inIgst} THEN l."creditPaise" - l."debitPaise" ELSE 0 END)::bigint ig
      FROM "Voucher" v JOIN "LedgerLine" l ON l."voucherId" = v.id JOIN "StockOut" so ON so.id = v."refId" JOIN "Batch" b ON b.id = so."batchId" JOIN "Medicine" m ON m.id = b."medicineId"
      WHERE v."tenantId" = ${tenantId} AND v."refType" = 'supplier_return' AND v.date >= ${p.from} AND v.date < ${p.to} ${inBranches(Prisma.sql`v."branchId"`, branchIds)} GROUP BY 1`,
  ]);
  const rates = [...new Set([...bought.map((r) => r.rate), ...returned.map((r) => r.rate)])].sort((a, b) => a - b);
  return rates.map((rate) => {
    const b = bought.filter((r) => r.rate === rate), r = returned.find((x) => x.rate === rate);
    const sum = (f: (x: (typeof b)[number]) => bigint, igst: boolean) => b.filter((x) => x.igst === igst).reduce((a, x) => a + Number(f(x)), 0);
    const grossTaxable = sum((x) => x.taxable, false) + sum((x) => x.taxable, true), retTaxable = Number(r?.taxable ?? 0);
    const cs = sum((x) => x.tax, false) - Number(r?.cs ?? 0), igst = sum((x) => x.tax, true) - Number(r?.ig ?? 0);
    const cgst = Math.floor(cs / 2);
    return { rate, grossTaxable, retTaxable, taxable: grossTaxable - retTaxable, tax: cs + igst, cgst, sgst: cs - cgst, igst };
  });
}

export async function accountsOverview(ctx: Ctx, p: Period) {
  authorizeView(ctx, "reports");
  const [tot, all, cogsRows, gstOut, gstIn] = await Promise.all([
    accountTotals(ctx.tenantId, p.from, p.to),
    accountTotals(ctx.tenantId, null, new Date()),
    db.$queryRaw<{ c: bigint | null }[]>`SELECT SUM(si."costPaise" * (si.qty - si."returnedQty")) c FROM "SaleItem" si JOIN "Sale" s ON s.id = si."saleId" WHERE s."tenantId" = ${ctx.tenantId} AND s.at >= ${p.from} AND s.at < ${p.to}`,
    outputGstByRate(ctx.tenantId, p, null),
    inputGstByRate(ctx.tenantId, p, null),
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
    return { rate: r, outTaxable: o?.taxable ?? 0, outTax: o?.tax ?? 0, inTaxable: i?.taxable ?? 0, inTax: i?.tax ?? 0 };
  });
  return {
    period: p,
    pl: { sales, cogs, gross: sales - cogs, expenseLines, expenses, net: sales - cogs - expenses },
    cash: { cash: bal(ACC.cash), bank: bal(ACC.bank), receivable: bal(ACC.debtors), payable: -bal(ACC.creditors) },
    gst, gstTotals: { out: cr(ACC.cgst) + cr(ACC.sgst) + cr(ACC.igst), returnsReversed: retTax, in: dr(ACC.inCgst) + dr(ACC.inSgst) + dr(ACC.inIgst), inIgst: dr(ACC.inIgst) },
  };
}

export const DAY_BOOK_PAGE = 100;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
export function dayRange(from: string | undefined, to: string | undefined, fallback: Period) {
  const f = from && ISO_DAY.test(from) ? from : fallback.fromDay, t = to && ISO_DAY.test(to) ? to : addDays(fallback.toDay, -1);
  if (f > t) throw new UserError("The start date is after the end date.");
  return { fromDay: f, toDay: t, from: istMidnight(f), to: istMidnight(addDays(t, 1)) };
}

/** Accounts that have postings, plus the standard chart. */
export async function accountNames(ctx: Ctx) {
  const used = await db.$queryRaw<{ account: string }[]>`SELECT DISTINCT l.account FROM "LedgerLine" l JOIN "Voucher" v ON v.id = l."voucherId" WHERE v."tenantId" = ${ctx.tenantId}`;
  return [...new Set([...Object.values(ACC), ...EXPENSE_ACCOUNTS, ...used.map((u) => u.account)])].sort((a, b) => a.localeCompare(b));
}

const partyNames = async (tenantId: string, lines: { partyType: string | null; partyId: string | null }[]) => {
  const ids = (t: string) => [...new Set(lines.filter((l) => l.partyType === t && l.partyId).map((l) => l.partyId!))];
  const [s, c] = await Promise.all([
    db.supplier.findMany({ where: { tenantId, id: { in: ids("supplier") } }, select: { id: true, name: true } }),
    db.customer.findMany({ where: { tenantId, id: { in: ids("customer") } }, select: { id: true, name: true } }),
  ]);
  return new Map([...s, ...c].map((x) => [x.id, x.name]));
};

/** One account's postings between two IST dates (inclusive), with opening and running balance (+ = debit). */
export async function accountLedger(ctx: Ctx, account: string, fromDay?: string, toDay?: string) {
  authorizeView(ctx, "reports");
  const r = dayRange(fromDay, toDay, periodOf("month"));
  const [open, lines] = await Promise.all([
    db.$queryRaw<{ bal: bigint | null }[]>`SELECT SUM(l."debitPaise" - l."creditPaise") bal FROM "LedgerLine" l JOIN "Voucher" v ON v.id = l."voucherId" WHERE v."tenantId" = ${ctx.tenantId} AND l.account = ${account} AND v.date < ${r.from}`,
    db.ledgerLine.findMany({ where: { account, voucher: { tenantId: ctx.tenantId, date: { gte: r.from, lt: r.to } } }, include: { voucher: true }, orderBy: [{ voucher: { date: "asc" } }, { voucher: { no: "asc" } }], take: 5000 }),
  ]);
  const names = await partyNames(ctx.tenantId, lines);
  const opening = Number(open[0]?.bal ?? 0);
  let bal = opening, totalDr = 0, totalCr = 0;
  const rows = lines.map((l) => {
    const dr = big(l.debitPaise), cr = big(l.creditPaise);
    bal += dr - cr; totalDr += dr; totalCr += cr;
    return { id: l.id, date: l.voucher.date.toISOString(), no: l.voucher.no, type: l.voucher.type, narration: l.voucher.narration, party: l.partyId ? names.get(l.partyId) ?? "" : "", dr, cr, balance: bal };
  });
  return { account, fromDay: r.fromDay, toDay: r.toDay, opening, rows, totalDr, totalCr, closing: bal, truncated: lines.length >= 5000 };
}

/** Closing balance of every account as of the end of an IST date. Debits equal credits. */
export async function trialBalance(ctx: Ctx, asOfDay?: string) {
  authorizeView(ctx, "reports");
  const day = asOfDay && ISO_DAY.test(asOfDay) ? asOfDay : todayISO();
  const tot = await accountTotals(ctx.tenantId, null, istMidnight(addDays(day, 1)));
  const rows = [...tot].map(([account, t]) => ({ account, dr: Math.max(t.dr - t.cr, 0), cr: Math.max(t.cr - t.dr, 0) })).filter((r) => r.dr || r.cr).sort((a, b) => a.account.localeCompare(b.account));
  return { asOf: day, rows, dr: rows.reduce((a, r) => a + r.dr, 0), cr: rows.reduce((a, r) => a + r.cr, 0) };
}

/** Newest first, a page at a time; pass the last voucher id shown as `after` for the next page. */
export async function dayBook(ctx: Ctx, p: Period, after?: string, take = DAY_BOOK_PAGE) {
  if (!can(ctx, "reports") && !can(ctx, "payments")) authorizeView(ctx, "reports");
  const vs = await db.voucher.findMany({ where: { tenantId: ctx.tenantId, date: { gte: p.from, lt: p.to } }, include: { lines: true }, orderBy: [{ date: "desc" }, { no: "desc" }, { id: "desc" }], take, ...(after ? { cursor: { id: after }, skip: 1 } : {}) });
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

