import "server-only";
import { createHash } from "node:crypto";
import { db, type Tx } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorize, authorizeView, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { addDays, dateOnly, isoOf } from "@/lib/dates";
import { big, inr } from "@/lib/money";
import { cleanNumber, headerKey, type Table } from "@/domain/imports/parse";
import { parseBillDate, readEbillTable } from "@/domain/purchasing/ebill";
import { ACC } from "./accounts";
import { BANK_FIELDS, type BankField, type BankMapping } from "./bank-types";

export { BANK_FIELDS, type BankField, type BankMapping };

const SYN: Record<BankField, string[]> = {
  date: ["date", "txndate", "transactiondate", "trandate", "postdate", "postingdate", "valuedate", "valuedt", "txndt"],
  description: ["description", "narration", "particulars", "remarks", "details", "transactiondetails", "transactionremarks"],
  ref: ["ref", "refno", "chqno", "chequeno", "chqrefno", "chequerefno", "referenceno", "refchqno", "utr", "utrno", "instrumentno", "chqrefnumber", "refnochequeno", "chequenorefno", "refnochqno", "chqnorefno"],
  debit: ["debit", "withdrawal", "withdrawals", "withdrawalamt", "withdrawalamount", "dr", "debitamount", "debitamt", "withdrawalsdr"],
  credit: ["credit", "deposit", "deposits", "depositamt", "depositamount", "cr", "creditamount", "creditamt", "depositscr"],
  amount: ["amount", "txnamount", "transactionamount", "amountinr"],
  balance: ["balance", "closingbalance", "runningbalance", "bal", "availablebalance"],
};
export const MATCH_DAYS = 3;

export function bankAutoMapping(t: Table): BankMapping | null {
  for (let r = 0; r < Math.min(t.length, 25); r++) {
    const cols: Partial<Record<BankField, number>> = {};
    t[r].forEach((c, i) => { const k = headerKey(c); for (const [f, keys] of Object.entries(SYN) as [BankField, string[]][]) if (keys.includes(k) && cols[f] === undefined) cols[f] = i; });
    // "Value date" next to "Txn date": keep the first date column.
    if (cols.date !== undefined && (cols.amount !== undefined || (cols.debit !== undefined && cols.credit !== undefined))) return { headerRow: r, cols };
  }
  return null;
}
const ready = (m: BankMapping | null) => !!m && m.cols.date !== undefined && (m.cols.amount !== undefined || (m.cols.debit !== undefined && m.cols.credit !== undefined));

/** "1,234.50", "1,234.50 Cr", "(500.00)", "-500" → paise (signed). Dr = money out. */
export function bankAmount(raw: string): number | null {
  const s = raw.trim();
  if (!s) return null;
  const neg = /^\(.*\)$/.test(s) || /\bdr\.?$/i.test(s);
  const n = Number(cleanNumber(s.replace(/[()]/g, "").replace(/\s*(cr|dr)\.?$/i, "")));
  if (!Number.isFinite(n)) return null;
  return Math.round((neg ? -Math.abs(n) : n) * 100);
}

export type BankRow = { row: number; date: string; description: string; ref: string; amount: number; balance: number | null };
export function bankRows(t: Table, m: BankMapping): { rows: BankRow[]; skipped: number } {
  const at = (r: string[], f: BankField) => (m.cols[f] === undefined ? "" : (r[m.cols[f]!] ?? "").trim());
  const rows: BankRow[] = [];
  let skipped = 0;
  for (let i = m.headerRow + 1; i < t.length; i++) {
    const r = t[i], date = parseBillDate(at(r, "date"));
    const amount = m.cols.amount !== undefined ? bankAmount(at(r, "amount")) : (bankAmount(at(r, "credit")) ?? 0) - Math.abs(bankAmount(at(r, "debit")) ?? 0);
    if (!date || !amount) { skipped++; continue; }
    rows.push({ row: i, date, description: at(r, "description").slice(0, 200), ref: at(r, "ref").slice(0, 40), amount, balance: bankAmount(at(r, "balance")) });
  }
  return { rows, skipped };
}

/** Imports a bank statement (CSV / Excel), skipping rows already imported, then auto-matches. */
export async function importBankStatement(ctx: Ctx, fileName: string, bytes: Uint8Array, mappingIn?: BankMapping | null) {
  authorize(ctx, "payments");
  if (bytes.length > 4 * 1024 * 1024) throw new UserError("Statement file is larger than 4 MB.");
  let t: Table;
  try { t = readEbillTable(fileName, bytes); } catch (e) { throw new UserError(e instanceof Error ? e.message : "Couldn’t read the file."); }
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
  const saved = (tenant.settings as { bankMapping?: BankMapping }).bankMapping ?? null;
  const m = mappingIn ?? (ready(saved) && t[saved!.headerRow] ? saved : bankAutoMapping(t));
  const preview = t.slice(0, 12).map((r) => r.slice(0, 20).map((c) => c.slice(0, 50)));
  if (!m || !ready(m)) return { needsMapping: true as const, preview, mapping: m ?? { headerRow: -1, cols: {} } };
  const { rows, skipped } = bankRows(t, m);
  if (!rows.length) throw new UserError("No transactions found with this column mapping.");
  return db.$transaction(async (tx) => {
    const seen = new Map<string, number>();
    const prints = rows.map((r) => {
      const base = [r.date, r.amount, r.description, r.ref, r.balance ?? ""].join("|");
      const n = (seen.get(base) ?? 0) + 1; seen.set(base, n);
      return createHash("sha256").update(base + "|" + n).digest("hex").slice(0, 40);
    });
    const dup = new Set((await tx.bankLine.findMany({ where: { tenantId: ctx.tenantId, fingerprint: { in: prints } }, select: { fingerprint: true } })).map((x) => x.fingerprint));
    const fresh = rows.map((r, i) => ({ r, fp: prints[i] })).filter((x) => !dup.has(x.fp));
    const st = await tx.bankStatement.create({ data: { tenantId: ctx.tenantId, fileName: fileName.slice(0, 120), lines: fresh.length, createdBy: ctx.userId } });
    if (fresh.length) await tx.bankLine.createMany({ data: fresh.map(({ r, fp }) => ({ tenantId: ctx.tenantId, statementId: st.id, date: dateOnly(r.date), description: r.description, ref: r.ref || null, amountPaise: BigInt(r.amount), balancePaise: r.balance == null ? null : BigInt(r.balance), row: r.row, fingerprint: fp })) });
    if (mappingIn) await tx.tenant.update({ where: { id: ctx.tenantId }, data: { settings: { ...(tenant.settings as object), bankMapping: mappingIn } } });
    const matched = await autoMatch(tx, ctx);
    await writeAudit(tx, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Bank statement imported", entity: "bank_statement", entityId: st.id, detail: `${fileName} · ${fresh.length} new, ${rows.length - fresh.length} already imported, ${skipped} skipped · ${matched} auto-matched` });
    return { needsMapping: false as const, imported: fresh.length, duplicates: rows.length - fresh.length, skipped, matched };
  }, { timeout: 30000 });
}

type Cand = { id: string; date: Date; dr: bigint; cr: bigint; narration: string; no: string };
async function bankLedgerLines(tx: Tx | typeof db, tenantId: string, from: Date, to: Date) {
  return tx.$queryRaw<Cand[]>`
    SELECT l.id, v.date, l."debitPaise" dr, l."creditPaise" cr, v.narration, v.no FROM "LedgerLine" l JOIN "Voucher" v ON v.id = l."voucherId"
    WHERE v."tenantId" = ${tenantId} AND l.account = ${ACC.bank} AND v.date >= ${from} AND v.date < ${to}
      AND NOT EXISTS (SELECT 1 FROM "BankLine" b WHERE b."ledgerLineId" = l.id) ORDER BY v.date`;
}
const signed = (c: Cand) => big(c.dr) - big(c.cr);
const istDay = (d: Date) => isoOf(new Date(d.getTime() + 330 * 60_000));
const dayGap = (a: string, b: string) => Math.abs(dateOnly(a).getTime() - dateOnly(b).getTime()) / 86400_000;
const refTokens = (s: string) => new Set<string>([...(s.match(/\d{6,}/g) ?? []), ...(s.match(/[A-Z0-9]{10,}/gi) ?? [])].map((x) => x.toUpperCase()));

/**
 * Matches unreconciled statement lines to Bank account ledger lines with the same amount and direction within
 * ±3 days. A shared reference (cheque number, UTR) wins; otherwise a match is made only when it is the single
 * candidate both ways, so ambiguous lines are left for manual matching.
 */
export async function autoMatch(tx: Tx, ctx: Ctx) {
  const open = await tx.bankLine.findMany({ where: { tenantId: ctx.tenantId, ledgerLineId: null }, orderBy: { date: "asc" } });
  if (!open.length) return 0;
  const from = new Date(dateOnly(addDays(isoOf(open[0].date), -MATCH_DAYS - 1)).getTime());
  const to = new Date(dateOnly(addDays(isoOf(open[open.length - 1].date), MATCH_DAYS + 2)).getTime());
  const cands = await bankLedgerLines(tx, ctx.tenantId, from, to);
  const used = new Set<string>();
  let n = 0;
  const near = (b: (typeof open)[number]) => cands.filter((c) => !used.has(c.id) && signed(c) === big(b.amountPaise) && dayGap(istDay(c.date), isoOf(b.date)) <= MATCH_DAYS);
  for (const b of open) {
    const cs = near(b);
    if (!cs.length) continue;
    const toks = refTokens(`${b.ref ?? ""} ${b.description}`);
    const byRef = cs.filter((c) => [...refTokens(c.narration)].some((t) => toks.has(t)));
    let pick: Cand | null = byRef.length === 1 ? byRef[0] : null;
    if (!pick && cs.length === 1) {
      const rivals = open.filter((o) => o.id !== b.id && !o.ledgerLineId && big(o.amountPaise) === big(b.amountPaise) && dayGap(isoOf(o.date), istDay(cs[0].date)) <= MATCH_DAYS);
      if (!rivals.length) pick = cs[0];
    }
    if (!pick) continue;
    used.add(pick.id);
    await tx.bankLine.update({ where: { id: b.id }, data: { ledgerLineId: pick.id, matchedBy: "auto", reconciledAt: new Date(), reconciledBy: ctx.userId } });
    n++;
  }
  return n;
}

export async function matchBankLine(ctx: Ctx, bankLineId: string, ledgerLineId: string) {
  authorize(ctx, "payments");
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"bank:" + ctx.tenantId}))`;
    const b = await tx.bankLine.findFirst({ where: { id: bankLineId, tenantId: ctx.tenantId } });
    if (!b) throw new UserError("Statement line not found.");
    if (b.ledgerLineId) throw new UserError("This statement line is already matched. Unmatch it first.");
    const l = await tx.ledgerLine.findFirst({ where: { id: ledgerLineId, account: ACC.bank, voucher: { tenantId: ctx.tenantId } }, include: { voucher: true } });
    if (!l) throw new UserError("Bank entry not found.");
    if (big(l.debitPaise) - big(l.creditPaise) !== big(b.amountPaise)) throw new UserError(`Amounts differ: statement ${inr(big(b.amountPaise))}, books ${inr(big(l.debitPaise) - big(l.creditPaise))}.`);
    if (await tx.bankLine.findFirst({ where: { ledgerLineId } })) throw new UserError(`${l.voucher.no} is already matched to another statement line.`);
    await tx.bankLine.update({ where: { id: b.id }, data: { ledgerLineId, matchedBy: "manual", reconciledAt: new Date(), reconciledBy: ctx.userId } });
    await writeAudit(tx, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Bank line reconciled", entity: "bank_line", entityId: b.id, detail: `${isoOf(b.date)} ${inr(big(b.amountPaise))} ↔ ${l.voucher.no}` });
  });
}

export async function unmatchBankLine(ctx: Ctx, bankLineId: string) {
  authorize(ctx, "payments");
  return db.$transaction(async (tx) => {
    const b = await tx.bankLine.findFirst({ where: { id: bankLineId, tenantId: ctx.tenantId } });
    if (!b?.ledgerLineId) throw new UserError("This statement line isn’t matched.");
    await tx.bankLine.update({ where: { id: b.id }, data: { ledgerLineId: null, matchedBy: null, reconciledAt: null, reconciledBy: null } });
    await writeAudit(tx, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Bank match removed", entity: "bank_line", entityId: b.id, detail: `${isoOf(b.date)} ${inr(big(b.amountPaise))}` });
  });
}

/**
 * Reconciliation view: statement lines not yet matched (each with same-amount book entries within ±15 days to pick
 * from), book entries on the Bank account not on any statement, and the last statement balance against the books.
 */
export async function bankReconciliation(ctx: Ctx) {
  authorizeView(ctx, "payments", "reports");
  const [open, matched, first, last, recent] = await Promise.all([
    db.bankLine.findMany({ where: { tenantId: ctx.tenantId, ledgerLineId: null }, orderBy: { date: "asc" }, take: 500 }),
    db.bankLine.count({ where: { tenantId: ctx.tenantId, ledgerLineId: { not: null } } }),
    db.bankLine.findFirst({ where: { tenantId: ctx.tenantId }, orderBy: { date: "asc" } }),
    db.bankLine.findFirst({ where: { tenantId: ctx.tenantId, balancePaise: { not: null } }, orderBy: [{ date: "desc" }, { statement: { createdAt: "desc" } }, { row: "desc" }] }),
    db.bankLine.findMany({ where: { tenantId: ctx.tenantId, ledgerLineId: { not: null } }, orderBy: { reconciledAt: "desc" }, take: 30 }),
  ]);
  const recentVouchers = await db.ledgerLine.findMany({ where: { id: { in: recent.map((r) => r.ledgerLineId!) } }, select: { id: true, voucher: { select: { no: true } } } });
  const since = first ? dateOnly(addDays(isoOf(first.date), -15)) : new Date(0);
  const books = await bankLedgerLines(db, ctx.tenantId, since, new Date(Date.now() + 86400_000));
  const book = await db.$queryRaw<{ bal: bigint | null }[]>`
    SELECT SUM(l."debitPaise" - l."creditPaise") bal FROM "LedgerLine" l JOIN "Voucher" v ON v.id = l."voucherId"
    WHERE v."tenantId" = ${ctx.tenantId} AND l.account = ${ACC.bank} AND v.date < ${last ? dateOnly(addDays(isoOf(last.date), 1)) : new Date()}`;
  const entry = (c: Cand) => ({ id: c.id, date: istDay(c.date), amount: signed(c), no: c.no, narration: c.narration });
  return {
    matched,
    statement: open.map((b) => ({
      id: b.id, date: isoOf(b.date), description: b.description, ref: b.ref, amount: big(b.amountPaise),
      candidates: books.filter((c) => signed(c) === big(b.amountPaise) && dayGap(istDay(c.date), isoOf(b.date)) <= 15).map(entry),
    })),
    books: books.map(entry),
    recent: recent.map((b) => ({ id: b.id, date: isoOf(b.date), description: b.description, amount: big(b.amountPaise), matchedBy: b.matchedBy, voucherNo: recentVouchers.find((v) => v.id === b.ledgerLineId)?.voucher.no ?? "" })),
    balance: last ? { date: isoOf(last.date), bank: big(last.balancePaise), books: Number(book[0]?.bal ?? 0) } : null,
  };
}
