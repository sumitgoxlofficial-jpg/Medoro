import "server-only";
/**
 * Bill matching for pharmacies whose data is on this server (self-hosted). The same rules as the counters
 * (src/domain/finance/match.ts), on PostgreSQL:
 *   - a bank statement credit not matched to a book entry can pay credit bills;
 *   - each match posts a receipt voucher (Dr Bank account / Cr Sundry debtors, dated on the statement date) and links
 *     it to the statement line and the bill (BankAllocation), so the books, the customer's balance and the bank
 *     reconciliation agree; undo posts a reversal;
 *   - what is still due on a bill comes from the ledger: the customer's outstanding sits on their newest bills (older
 *     ones count as paid first), and bills a bank match paid are honoured exactly.
 * Amount alone is never matched automatically, and nothing is automatic while a book entry of the same amount is
 * waiting to be matched (that receipt may already be in the books).
 */
import { db, type Tx } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorize, authorizeView, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { postVoucher } from "@/domain/accounting/post";
import { ACC } from "@/domain/accounting/accounts";
import { dateOnly, isoOf, istDate } from "@/lib/dates";
import { big, inr } from "@/lib/money";
import { parseNarration } from "./narration";
import { customerRef, medoroRef, propose, type CreditIn, type OpenBill, type Proposal } from "./match";

type DbOrTx = Tx | typeof db;
const NOT_PAYMENTS = new Set(["settlement", "interest", "charges", "cash", "atm"]);
export const BOOK_WINDOW_DAYS = 3;

/** Credit bills with what is still due on each (voided bills left out). */
export async function serverOpenBills(tx: DbOrTx, tenantId: string, includePaid = false) {
  const rows = await tx.$queryRaw<{ saleId: string; invoiceNo: string; customerId: string; customerName: string; at: Date; credit: bigint; returned: bigint; tied: bigint }[]>`
    SELECT s.id AS "saleId", s."invoiceNo", s."customerId", c.name AS "customerName", s.at,
           (SELECT COALESCE(SUM(p."amountPaise"), 0) FROM "Payment" p WHERE p."saleId" = s.id AND p.mode = 'credit') AS credit,
           (SELECT COALESCE(SUM(r."amountPaise"), 0) FROM "SalesReturn" r WHERE r."saleId" = s.id AND r."refundMode" = 'Adjust customer credit') AS returned,
           (SELECT COALESCE(SUM(a."amountPaise"), 0) FROM "BankAllocation" a WHERE a."saleId" = s.id) AS tied
      FROM "Sale" s JOIN "Customer" c ON c.id = s."customerId"
     WHERE s."tenantId" = ${tenantId} AND NOT EXISTS (SELECT 1 FROM "SaleVoid" v WHERE v."saleId" = s.id)
       AND EXISTS (SELECT 1 FROM "Payment" p WHERE p."saleId" = s.id AND p.mode = 'credit')
     ORDER BY s.at DESC, s."invoiceNo" DESC`;
  const owed = new Map((await tx.$queryRaw<{ id: string; bal: bigint }[]>`
    SELECT l."partyId" AS id, SUM(l."debitPaise" - l."creditPaise") AS bal FROM "LedgerLine" l JOIN "Voucher" v ON v.id = l."voucherId"
     WHERE v."tenantId" = ${tenantId} AND l.account = ${ACC.debtors} AND l."partyType" = 'customer' GROUP BY l."partyId"`).map((r) => [r.id, Math.max(0, Number(r.bal))]));
  const out: (OpenBill & { creditPaise: number; paidPaise: number })[] = [];
  // Newest first: the customer's outstanding fills their newest bills; whatever is left over is paid.
  for (const b of rows) {
    const base = Math.max(0, big(b.credit) - big(b.returned) - big(b.tied));
    const left = owed.get(b.customerId) ?? 0;
    const bal = Math.min(base, left);
    owed.set(b.customerId, left - bal);
    if (bal > 0 || includePaid) out.push({ saleId: b.saleId, invoiceNo: b.invoiceNo, customerId: b.customerId, customerName: b.customerName, date: istDate(b.at), balancePaise: bal, creditPaise: big(b.credit), paidPaise: big(b.credit) - big(b.returned) - bal });
  }
  return out.reverse();
}

type Line = { id: string; date: Date; description: string; ref: string | null; amountPaise: bigint; allocated: bigint };

/** Statement credits not matched to a book entry, with what is still unallocated. */
async function openCredits(tx: DbOrTx, tenantId: string) {
  const rows = await tx.$queryRaw<Line[]>`
    SELECT b.id, b.date, b.description, b.ref, b."amountPaise", COALESCE((SELECT SUM(a."amountPaise") FROM "BankAllocation" a WHERE a."bankLineId" = b.id), 0) AS allocated
      FROM "BankLine" b WHERE b."tenantId" = ${tenantId} AND b."ledgerLineId" IS NULL AND b."amountPaise" > 0 ORDER BY b.date, b.row`;
  return rows.map((r) => ({ ...r, nar: parseNarration(r.description, r.ref ?? "") }))
    .filter((r) => big(r.amountPaise) - big(r.allocated) > 0 && !NOT_PAYMENTS.has(r.nar.channel));
}

/** Unmatched Bank account debits in the books (receipts already recorded), for the double-count guard. */
async function waitingBookEntries(tx: DbOrTx, tenantId: string) {
  return (await tx.$queryRaw<{ date: Date; amt: bigint }[]>`
    SELECT v.date, l."debitPaise" - l."creditPaise" AS amt FROM "LedgerLine" l JOIN "Voucher" v ON v.id = l."voucherId"
     WHERE v."tenantId" = ${tenantId} AND l.account = ${ACC.bank} AND l."debitPaise" > 0
       AND NOT EXISTS (SELECT 1 FROM "BankLine" b WHERE b."ledgerLineId" = l.id)
       AND NOT EXISTS (SELECT 1 FROM "BankAllocation" a WHERE a."ledgerLineId" = l.id)`).map((r) => ({ date: istDate(r.date), amount: big(r.amt) }));
}

export type BillProposal = Proposal & { bookWarning: boolean };

async function proposals(tx: DbOrTx, tenantId: string) {
  const [credits, bills, rejected, book] = await Promise.all([
    openCredits(tx, tenantId), serverOpenBills(tx, tenantId),
    tx.bankMatchReject.findMany({ where: { tenantId }, select: { bankLineId: true, saleId: true } }),
    waitingBookEntries(tx, tenantId),
  ]);
  const ins: CreditIn[] = credits.map((c) => ({ id: c.id, remainingPaise: big(c.amountPaise) - big(c.allocated), date: isoOf(c.date), description: `${c.description} ${c.ref ?? ""}`, utr: c.nar.utr, vpa: c.nar.vpa }));
  const props = propose(ins, { bills, counter: [], receipts: [], rejected: new Set(rejected.map((r) => `${r.bankLineId}|${r.saleId}`)), knownPayers: new Map(), autoKnownPayers: false });
  const out = new Map<string, BillProposal[]>();
  for (const c of ins) {
    const warn = book.some((b) => b.amount === c.remainingPaise && Math.abs(dateOnly(b.date).getTime() - dateOnly(c.date).getTime()) <= BOOK_WINDOW_DAYS * 86400_000);
    out.set(c.id, (props.get(c.id) ?? []).map((p) => ({ ...p, auto: p.auto && !warn, bookWarning: warn })));
  }
  return { credits, bills, props: out };
}

/** Posts the receipt for (part of) a statement credit against a bill. Caller holds the bank lock. */
async function allocateIn(tx: Tx, ctx: Ctx, i: { bankLineId: string; saleId: string; amountPaise: number; kind: "auto" | "approved" | "manual"; rule: number | null }) {
  if (!Number.isInteger(i.amountPaise) || i.amountPaise <= 0) throw new UserError("Enter the amount.");
  const line = await tx.bankLine.findFirst({ where: { id: i.bankLineId, tenantId: ctx.tenantId }, include: { allocations: { select: { amountPaise: true } } } });
  if (!line) throw new UserError("Statement line not found.");
  if (line.ledgerLineId) throw new UserError("This statement line is already matched to a book entry.");
  if (big(line.amountPaise) <= 0) throw new UserError("Only money received can pay a bill.");
  const left = big(line.amountPaise) - line.allocations.reduce((a, x) => a + big(x.amountPaise), 0);
  if (i.amountPaise > left) throw new UserError(`Only ${inr(left)} of this statement line is left to match.`);
  const sale = await tx.sale.findFirst({ where: { id: i.saleId, tenantId: ctx.tenantId }, select: { customerId: true } });
  if (!sale?.customerId) throw new UserError("Bill not found.");
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"party:" + sale.customerId}))`;
  const bill = (await serverOpenBills(tx, ctx.tenantId)).find((b) => b.saleId === i.saleId);
  if (!bill) throw new UserError("That bill has nothing left to pay.");
  if (i.amountPaise > bill.balancePaise) throw new UserError(`${bill.invoiceNo} has only ${inr(bill.balancePaise)} left to pay.`);
  const nar = parseNarration(line.description, line.ref ?? "");
  const v = await postVoucher(tx, {
    tenantId: ctx.tenantId, branchId: ctx.branchId, type: "receipt", userId: ctx.userId, refType: "bank_receipt", refId: line.id,
    // Statement date at noon IST, so the receipt falls on the day the bank shows.
    date: new Date(dateOnly(isoOf(line.date)).getTime() + 6.5 * 3600_000),
    narration: `Receipt from ${bill.customerName} · bank ${nar.utr ?? isoOf(line.date)} · for ${bill.invoiceNo}`.slice(0, 200),
    lines: [{ account: ACC.bank, dr: i.amountPaise }, { account: ACC.debtors, cr: i.amountPaise, partyType: "customer", partyId: bill.customerId }],
  });
  const bankLedger = await tx.ledgerLine.findFirstOrThrow({ where: { voucherId: v.id, account: ACC.bank } });
  const a = await tx.bankAllocation.create({ data: { tenantId: ctx.tenantId, bankLineId: line.id, saleId: bill.saleId, customerId: bill.customerId, amountPaise: BigInt(i.amountPaise), voucherId: v.id, ledgerLineId: bankLedger.id, kind: i.kind, rule: i.rule, userId: ctx.userId } });
  await writeAudit(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: `Bank credit matched to ${bill.invoiceNo}`, entity: "bank_line", entityId: line.id,
    detail: `${isoOf(line.date)} ${inr(i.amountPaise)} → ${bill.invoiceNo} (${bill.customerName}) · ${v.no} · ${i.kind}${i.rule ? `, rule ${i.rule}` : ""}` });
  return { id: a.id, voucherNo: v.no };
}

const bankLock = (tx: Tx, tenantId: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"bank:" + tenantId}))`;

/** Records every automatic match that still holds (inside the statement import). Returns how many lines it matched. */
export async function autoAllocateBills(tx: Tx, ctx: Ctx) {
  const matched = new Set<string>();
  for (let pass = 0; pass < 25; pass++) {
    const { props } = await proposals(tx, ctx.tenantId);
    let made = 0;
    for (const ps of props.values()) {
      const p = ps.find((x) => x.auto);
      if (!p) continue;
      try {
        await tx.$executeRaw`SAVEPOINT bill_alloc`;
        await allocateIn(tx, ctx, { bankLineId: p.txnId, saleId: p.targetId, amountPaise: p.amountPaise, kind: "auto", rule: p.rule });
        await tx.$executeRaw`RELEASE SAVEPOINT bill_alloc`;
        made++; matched.add(p.txnId);
      } catch (e) {
        await tx.$executeRaw`ROLLBACK TO SAVEPOINT bill_alloc`;
        if (!(e instanceof UserError)) throw e; // the bill changed in this pass: the next pass re-checks
      }
    }
    if (!made) break;
  }
  return matched.size;
}

/** Approves a suggestion (or matches by hand with `amountPaise`). */
export async function allocateBill(ctx: Ctx, i: { bankLineId: string; saleId: string; amountPaise?: number }) {
  authorize(ctx, "payments");
  return db.$transaction(async (tx) => {
    await bankLock(tx, ctx.tenantId);
    if (i.amountPaise == null) {
      const p = (await proposals(tx, ctx.tenantId)).props.get(i.bankLineId)?.find((x) => x.targetId === i.saleId);
      if (!p) throw new UserError("That suggestion no longer fits. Refresh and look again.");
      return allocateIn(tx, ctx, { bankLineId: i.bankLineId, saleId: i.saleId, amountPaise: p.amountPaise, kind: "approved", rule: p.rule });
    }
    return allocateIn(tx, ctx, { bankLineId: i.bankLineId, saleId: i.saleId, amountPaise: i.amountPaise, kind: "manual", rule: null });
  });
}

/** Undoes a bill match: a reversal voucher and a negative allocation; the pair isn't suggested again. */
export async function unallocateBill(ctx: Ctx, allocationId: string, reason = "Bank match undone") {
  authorize(ctx, "payments");
  return db.$transaction(async (tx) => {
    await bankLock(tx, ctx.tenantId);
    const a = await tx.bankAllocation.findFirst({ where: { id: allocationId, tenantId: ctx.tenantId } });
    if (!a || a.kind === "reversal") throw new UserError("Match not found.");
    if (await tx.bankAllocation.findFirst({ where: { reversesId: a.id } })) throw new UserError("This match was already undone.");
    const orig = await tx.voucher.findUniqueOrThrow({ where: { id: a.voucherId }, include: { lines: true } });
    const v = await postVoucher(tx, {
      tenantId: ctx.tenantId, branchId: ctx.branchId, type: "reversal", userId: ctx.userId, refType: "bank_receipt_undo", refId: a.bankLineId, reversesId: orig.id,
      narration: `Reversal of ${orig.no}: ${reason}`.slice(0, 200),
      lines: orig.lines.map((l) => ({ account: l.account, dr: big(l.creditPaise), cr: big(l.debitPaise), partyType: (l.partyType ?? undefined) as "customer" | undefined, partyId: l.partyId ?? undefined })),
    });
    const bankLedger = await tx.ledgerLine.findFirstOrThrow({ where: { voucherId: v.id, account: ACC.bank } });
    await tx.bankAllocation.create({ data: { tenantId: ctx.tenantId, bankLineId: a.bankLineId, saleId: a.saleId, customerId: a.customerId, amountPaise: -a.amountPaise, voucherId: v.id, ledgerLineId: bankLedger.id, kind: "reversal", reversesId: a.id, userId: ctx.userId } });
    await tx.bankMatchReject.upsert({ where: { bankLineId_saleId: { bankLineId: a.bankLineId, saleId: a.saleId } }, create: { tenantId: ctx.tenantId, bankLineId: a.bankLineId, saleId: a.saleId, userId: ctx.userId }, update: {} });
    await writeAudit(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: "Bank bill match undone", entity: "bank_line", entityId: a.bankLineId, detail: `${inr(big(a.amountPaise))} · ${orig.no} reversed by ${v.no}` });
    return { voucherNo: v.no };
  });
}

export async function rejectBillSuggestion(ctx: Ctx, bankLineId: string, saleId: string) {
  authorize(ctx, "payments");
  const line = await db.bankLine.findFirst({ where: { id: bankLineId, tenantId: ctx.tenantId }, select: { id: true } });
  if (!line) throw new UserError("Statement line not found.");
  await db.bankMatchReject.upsert({ where: { bankLineId_saleId: { bankLineId, saleId } }, create: { tenantId: ctx.tenantId, bankLineId, saleId, userId: ctx.userId }, update: {} });
  return true;
}

/** The bill-matching screen: suggestions, unmatched credits, recent matches, open and part-paid bills. */
export async function billMatching(ctx: Ctx) {
  authorizeView(ctx, "payments", "reports");
  const { credits, bills, props } = await proposals(db, ctx.tenantId);
  const all = await serverOpenBills(db, ctx.tenantId, true);
  const recent = await db.bankAllocation.findMany({ where: { tenantId: ctx.tenantId, kind: { not: "reversal" } }, orderBy: { createdAt: "desc" }, take: 50, include: { bankLine: { select: { date: true, description: true } } } });
  const undone = new Set((await db.bankAllocation.findMany({ where: { tenantId: ctx.tenantId, reversesId: { in: recent.map((r) => r.id) } }, select: { reversesId: true } })).map((r) => r.reversesId));
  const sales = new Map((await db.sale.findMany({ where: { id: { in: recent.map((r) => r.saleId) } }, select: { id: true, invoiceNo: true, customer: { select: { name: true } } } })).map((s) => [s.id, s]));
  const vouchers = new Map((await db.voucher.findMany({ where: { id: { in: recent.map((r) => r.voucherId) } }, select: { id: true, no: true } })).map((v) => [v.id, v.no]));
  const line = (c: (typeof credits)[number]) => ({
    id: c.id, date: isoOf(c.date), description: c.description, amountPaise: big(c.amountPaise), leftPaise: big(c.amountPaise) - big(c.allocated),
    utr: c.nar.utr, channel: c.nar.channel, payer: [c.nar.name, c.nar.vpa].filter(Boolean).join(" · ") || null,
  });
  return {
    suggested: credits.filter((c) => (props.get(c.id) ?? []).length).map((c) => ({ ...line(c), suggestions: props.get(c.id)! })),
    unmatched: credits.filter((c) => !(props.get(c.id) ?? []).length).map(line),
    recent: recent.map((r) => ({ id: r.id, at: r.createdAt.toISOString(), date: isoOf(r.bankLine.date), description: r.bankLine.description, amountPaise: big(r.amountPaise), kind: r.kind, rule: r.rule, undone: undone.has(r.id), invoiceNo: sales.get(r.saleId)?.invoiceNo ?? "", customer: sales.get(r.saleId)?.customer?.name ?? "", voucherNo: vouchers.get(r.voucherId) ?? "" })),
    openBills: bills.map((b) => ({ ...b, medoroRef: medoroRef(b.invoiceNo), customerRef: customerRef(b.customerId) })),
    partBills: all.filter((b) => b.paidPaise > 0 && b.balancePaise > 0),
  };
}

/** Net amount each statement line has paid to bills (undone matches net to zero). */
export async function allocatedByLine(tx: DbOrTx, tenantId: string) {
  const r = await tx.bankAllocation.groupBy({ by: ["bankLineId"], where: { tenantId }, _sum: { amountPaise: true } });
  return new Map(r.map((x) => [x.bankLineId, big(x._sum.amountPaise)]));
}
