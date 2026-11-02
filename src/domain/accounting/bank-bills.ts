import "server-only";
import { db, type Tx } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorize, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { isoOf } from "@/lib/dates";
import { big, inr } from "@/lib/money";
import { parseNarration } from "@/domain/finance/narration";
import { propose, type OpenBill, type Proposal } from "@/domain/finance/match";
import { customerBalances } from "@/domain/parties/balances";
import { ACC } from "./accounts";
import { postVoucher } from "./post";

/**
 * Bill-level matching for pharmacies whose data is on this server (Drive counters do the same on the device, see
 * drivedb/money.ts). A bank credit that isn't a receipt already in the books is matched to the credit bill it pays,
 * with the same rules (domain/finance/match.ts): Medoro's payment reference or the exact invoice number in the
 * narration match automatically; an amount alone is only ever a suggestion. Matching posts the customer receipt into
 * the Bank account and ticks the statement line off against it; undoing it reverses that receipt (nothing is edited).
 *
 * A bill's open amount: the server keeps no per-bill payments, so each customer's outstanding balance is spread over
 * their credit bills from the newest back (the oldest are taken as paid first, as on the counters).
 */
export async function openCreditBills(q: Tx | typeof db, tenantId: string): Promise<OpenBill[]> {
  const due = await customerBalances(q, tenantId);
  const owing = [...due].filter(([, v]) => v > 0).map(([id]) => id);
  if (!owing.length) return [];
  const sales = await q.sale.findMany({
    where: { tenantId, customerId: { in: owing }, voided: null, payments: { some: { mode: "credit" } } },
    select: { id: true, invoiceNo: true, at: true, customerId: true, customer: { select: { name: true } }, payments: { where: { mode: "credit" }, select: { amountPaise: true } } },
    orderBy: [{ at: "desc" }, { invoiceNo: "desc" }],
  });
  const left = new Map(owing.map((id) => [id, due.get(id)!]));
  const out: OpenBill[] = [];
  for (const s of sales) {
    const rest = left.get(s.customerId!) ?? 0;
    if (rest <= 0) continue;
    const credit = s.payments.reduce((a, p) => a + big(p.amountPaise), 0);
    const open = Math.min(rest, credit);
    left.set(s.customerId!, rest - open);
    if (open > 0) out.push({ saleId: s.id, invoiceNo: s.invoiceNo, customerId: s.customerId!, customerName: s.customer?.name ?? "Customer", date: isoOf(s.at), balancePaise: open });
  }
  return out;
}

/** Suggestions for the open bank credits (best first per line). */
export async function billProposals(q: Tx | typeof db, tenantId: string) {
  const all = await q.bankLine.findMany({ where: { tenantId, ledgerLineId: null, amountPaise: { gt: 0 } }, orderBy: { date: "asc" }, take: 500 });
  if (!all.length) return new Map<string, Proposal[]>();
  // A credit whose receipt is already in the books (an unmatched Bank entry of the same amount within 15 days) is
  // matched to that entry, never to a bill: a bill match would record the money twice.
  const from = new Date(all[0].date.getTime() - 16 * 86400_000);
  const entries = await q.$queryRaw<{ amt: bigint; date: Date }[]>`
    SELECT l."debitPaise" - l."creditPaise" amt, v.date FROM "LedgerLine" l JOIN "Voucher" v ON v.id = l."voucherId"
    WHERE v."tenantId" = ${tenantId} AND l.account = ${ACC.bank} AND v.date >= ${from} AND l."debitPaise" > 0
      AND NOT EXISTS (SELECT 1 FROM "BankLine" b WHERE b."ledgerLineId" = l.id)`;
  const lines = all.filter((l) => !entries.some((e) => big(e.amt) === big(l.amountPaise) && Math.abs(e.date.getTime() - l.date.getTime()) <= 16 * 86400_000));
  if (!lines.length) return new Map<string, Proposal[]>();
  const bills = await openCreditBills(q, tenantId);
  if (!bills.length) return new Map<string, Proposal[]>();
  const credits = lines.map((l) => {
    const n = parseNarration(l.description, l.ref ?? "");
    return { id: l.id, remainingPaise: big(l.amountPaise), date: isoOf(l.date), description: `${l.description} ${l.ref ?? ""}`, utr: n.utr, vpa: n.vpa };
  });
  const rejected = new Set(lines.flatMap((l) => l.rejectedSaleIds.map((s) => `${l.id}|${s}`)));
  // Counter UPI and recorded receipts are already in the Bank account and matched by the ledger matcher.
  const out = propose(credits, { bills, counter: [], receipts: [], rejected, knownPayers: new Map(), autoKnownPayers: false });
  for (const [id, ps] of out) out.set(id, ps.filter((p) => p.target === "bill"));
  return out;
}

/**
 * Records that a bank credit paid a bill: posts the receipt (Dr Bank, Cr the customer) and matches the statement
 * line to its bank entry. The whole credit goes to the customer, so it may not exceed what they owe.
 */
export async function applyBillMatch(tx: Tx, ctx: Ctx, bankLineId: string, saleId: string, how: { auto: boolean; rule?: number }) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"bank:" + ctx.tenantId}))`;
  const b = await tx.bankLine.findFirst({ where: { id: bankLineId, tenantId: ctx.tenantId } });
  if (!b) throw new UserError("Statement line not found.");
  if (b.ledgerLineId) throw new UserError("This statement line is already matched. Unmatch it first.");
  const amount = big(b.amountPaise);
  if (amount <= 0) throw new UserError("Only money received can pay a bill.");
  const sale = await tx.sale.findFirst({ where: { id: saleId, tenantId: ctx.tenantId }, include: { customer: true, voided: true } });
  if (!sale?.customer || sale.voided) throw new UserError("Bill not found, or it was voided.");
  const owes = (await customerBalances(tx, ctx.tenantId)).get(sale.customer.id) ?? 0;
  if (amount > owes) throw new UserError(`${inr(amount)} is more than ${sale.customer.name} owes (${inr(owes)}). Record it under Parties instead.`);
  const ref = parseNarration(b.description, b.ref ?? "").utr ?? b.ref ?? "";
  const v = await postVoucher(tx, {
    tenantId: ctx.tenantId, branchId: ctx.branchId, type: "receipt", userId: ctx.userId, refType: "customer_receipt", refId: sale.customer.id, date: b.date,
    narration: `Receipt from ${sale.customer.name} · Bank${ref ? " · " + ref : ""} · for ${sale.invoiceNo}`,
    lines: [{ account: ACC.bank, dr: amount }, { account: ACC.debtors, cr: amount, partyType: "customer", partyId: sale.customer.id }],
  });
  const bankEntry = await tx.ledgerLine.findFirstOrThrow({ where: { voucherId: v.id, account: ACC.bank } });
  await tx.bankLine.update({ where: { id: b.id }, data: { ledgerLineId: bankEntry.id, saleId: sale.id, matchedBy: how.auto ? "bill-auto" : "bill", reconciledAt: new Date(), reconciledBy: ctx.userId } });
  await writeAudit(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: how.auto ? "Bank credit matched to a bill automatically" : "Bank credit matched to a bill", entity: "bank_line", entityId: b.id,
    detail: `${isoOf(b.date)} ${inr(amount)} → ${sale.invoiceNo} · ${sale.customer.name} · receipt ${v.no}${how.rule ? ` · rule ${how.rule}` : ""}` });
  return v.no;
}

/** After an import: posts the automatic bill matches (reference or invoice number in the narration). */
export async function autoMatchBills(tx: Tx, ctx: Ctx) {
  let n = 0;
  for (const ps of (await billProposals(tx, ctx.tenantId)).values()) {
    const p = ps.find((x) => x.auto);
    if (!p) continue;
    try { await applyBillMatch(tx, ctx, p.txnId, p.targetId, { auto: true, rule: p.rule }); n++; }
    catch (e) { if (!(e instanceof UserError)) throw e; } // e.g. more than the customer owes now: left as a suggestion
  }
  return n;
}

export async function matchBankLineToBill(ctx: Ctx, bankLineId: string, saleId: string) {
  authorize(ctx, "payments");
  return db.$transaction((tx) => applyBillMatch(tx, ctx, bankLineId, saleId, { auto: false }));
}

/** "Not this bill": never suggested for this line again. */
export async function rejectBillSuggestion(ctx: Ctx, bankLineId: string, saleId: string) {
  authorize(ctx, "payments");
  const b = await db.bankLine.findFirst({ where: { id: bankLineId, tenantId: ctx.tenantId } });
  if (!b) throw new UserError("Statement line not found.");
  if (!b.rejectedSaleIds.includes(saleId)) await db.bankLine.update({ where: { id: b.id }, data: { rejectedSaleIds: [...b.rejectedSaleIds, saleId] } });
}

/** Undoes a bill match: the receipt it posted is reversed and the statement line is open again. */
export async function undoBillMatch(tx: Tx, ctx: Ctx, b: { id: string; ledgerLineId: string | null; saleId: string | null; amountPaise: bigint; date: Date }) {
  const line = b.ledgerLineId ? await tx.ledgerLine.findUnique({ where: { id: b.ledgerLineId }, include: { voucher: { include: { lines: true } } } }) : null;
  await tx.bankLine.update({ where: { id: b.id }, data: { ledgerLineId: null, saleId: null, matchedBy: null, reconciledAt: null, reconciledBy: null } });
  if (!line) return;
  const v = line.voucher;
  if (await tx.voucher.findFirst({ where: { reversesId: v.id } })) return;
  const r = await postVoucher(tx, {
    tenantId: ctx.tenantId, branchId: v.branchId, type: "reversal", userId: ctx.userId, refType: "reversal", refId: v.id, reversesId: v.id,
    narration: `Reversal of ${v.no} · bank match undone`,
    lines: v.lines.map((l) => ({ account: l.account, dr: big(l.creditPaise), cr: big(l.debitPaise), partyType: (l.partyType ?? undefined) as "customer" | undefined, partyId: l.partyId ?? undefined })),
  });
  await writeAudit(tx, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Bank bill match undone", entity: "bank_line", entityId: b.id, detail: `${isoOf(b.date)} ${inr(big(b.amountPaise))} · ${v.no} reversed by ${r.no}` });
}
