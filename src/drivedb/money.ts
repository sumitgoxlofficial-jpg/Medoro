/**
 * UPI & Bank on the device (Drive counters): bank statement import, duplicate checks, matching credits to bills,
 * counter UPI payments and receipts, review queues and reports. The rules live in src/domain/finance (shared with
 * the server); this file loads the pharmacy's data, records decisions and keeps every record append-only.
 *
 * Ids that two counters could create for the same thing (a statement row, an automatic match and its receipt) are
 * derived from what they describe, so when both counters do it offline, sync keeps one copy.
 */
import { z } from "zod";
import { DriveDB } from "./client";
import { CounterError } from "./pharmacy";
import { addDays, istDate, todayISO } from "@/lib/dates";
import {
  accountKey, accountLabel, BANKS, bankAutoMapping, bankRows, mappingReady, previewOf, readStatementTable, rowFingerprint, withOccurrence,
  type BankMapping, type RowProblem,
} from "@/domain/finance/statement";
import { parseNarration, type Channel } from "@/domain/finance/narration";
import { classify, type DedupeHave } from "@/domain/finance/dedupe";
import { COUNTER_WINDOW_DAYS, medoroRef, propose, type CounterUpi, type CreditIn, type LooseReceipt, type MatchData, type OpenBill, type Proposal, type Target } from "@/domain/finance/match";

const n = (v: unknown) => Number(v ?? 0);
const now = () => new Date().toISOString();
const SYSTEM = "medoro";
/** Credits from these channels are never a customer paying a bill. */
const NOT_PAYMENTS: Channel[] = ["settlement", "interest", "charges", "cash", "atm"];

// ---------- settings (this device) ----------

export type FinSettings = { upiId: string; payee: string; autoKnownPayers: boolean };
const settingsInput = z.object({
  upiId: z.string().trim().max(60).refine((v) => !v || /^[A-Za-z0-9._-]{2,64}@[A-Za-z][A-Za-z0-9]{1,30}$/.test(v), "Enter the shop’s UPI ID, like shopname@okhdfcbank."),
  payee: z.string().trim().max(60),
  autoKnownPayers: z.boolean(),
});
export function finSettings(db: DriveDB): FinSettings {
  return { upiId: db.getMeta("fin:upiId") ?? "", payee: db.getMeta("fin:payee") ?? "", autoKnownPayers: db.getMeta("fin:autoKnown") === "1" };
}
export function saveFinSettings(db: DriveDB, input: FinSettings) {
  const s = settingsInput.parse(input);
  db.setMeta("fin:upiId", s.upiId); db.setMeta("fin:payee", s.payee); db.setMeta("fin:autoKnown", s.autoKnownPayers ? "1" : "0");
  return finSettings(db);
}

// ---------- statement import ----------

const accountInput = z.object({
  bank: z.enum(BANKS.map(([c]) => c) as [string, ...string[]], { message: "Pick the bank." }),
  last4: z.string().trim().regex(/^\d{4}$/, "Enter the last 4 digits of the account number."),
});

/** Reads a statement and shows what would be imported. Uses the column mapping saved for this bank, if any. */
export function statementPreview(db: DriveDB, fileName: string, bytes: Uint8Array, bank: string, mappingIn?: BankMapping | null) {
  let t;
  try { t = readStatementTable(fileName, bytes); } catch (e) { throw new CounterError(e instanceof Error ? e.message : "Couldn’t read the file."); }
  const savedRaw = db.getMeta(`fin:map:${bank}`);
  const saved = savedRaw ? (JSON.parse(savedRaw) as BankMapping) : null;
  // Column names found in the file win (a bank's CSV and Excel layouts differ); the saved mapping covers files
  // without recognisable headings.
  const mapping = mappingIn ?? bankAutoMapping(t) ?? (mappingReady(saved) && t[saved.headerRow] ? saved : null);
  const preview = previewOf(t);
  if (!mappingReady(mapping)) return { needsMapping: true as const, preview, mapping: mapping ?? { headerRow: -1, cols: {} } };
  const { rows, skipped, problems } = bankRows(t, mapping);
  const dates = rows.map((r) => r.date).sort();
  return {
    needsMapping: false as const, preview, mapping, skipped, problems,
    count: rows.length, credits: rows.filter((r) => r.amount > 0).length, debits: rows.filter((r) => r.amount < 0).length,
    fromDate: dates[0] ?? null, toDate: dates[dates.length - 1] ?? null,
    sample: rows.slice(0, 20).map((r) => ({ ...r, ...parseNarration(r.description, r.ref) })),
  };
}

export type ImportResult = { importId: string; rows: number; added: number; duplicates: number; review: number; skipped: number; problems: RowProblem[]; matched: number };

/**
 * Imports a statement: rows already imported (same row fingerprint) or provably the same payment (same UTR, or same
 * day, amount and narration from another file) are not added twice; doubtful ones are added and flagged for review.
 * Then matches what it can (see src/domain/finance/match.ts).
 */
export function importStatement(db: DriveDB, input: { fileName: string; bytes: Uint8Array; bank: string; last4: string; mapping?: BankMapping | null; userId: string }): ImportResult {
  const a = accountInput.parse({ bank: input.bank, last4: input.last4 });
  const account = accountKey(a.bank, a.last4);
  const p = statementPreview(db, input.fileName, input.bytes, a.bank, input.mapping);
  if (p.needsMapping) throw new CounterError("Choose which columns hold the date and the amounts first.");
  let t;
  try { t = readStatementTable(input.fileName, input.bytes); } catch (e) { throw new CounterError(e instanceof Error ? e.message : "Couldn’t read the file."); }
  const { rows, skipped, problems } = bankRows(t, p.mapping);
  if (!rows.length) throw new CounterError(problems.length ? `No row could be read. First problem: row ${problems[0].row}: ${problems[0].reason}` : "No transactions found in this file.");
  const source = `statement:${account}`;
  const result = db.transaction(() => {
    const importId = globalThis.crypto.randomUUID();
    const at = now();
    const dates = rows.map((r) => r.date).sort();
    const [fromDate, toDate] = [dates[0], dates[dates.length - 1]];
    // Candidates for duplicates: this account (and any source with the same UTR) around these dates.
    const have: DedupeHave[] = db.engine.all<DedupeHave & { bookedOn: string }>(
      `SELECT id, account, direction, amountPaise, bookedOn, utr, description, importId FROM finTxn WHERE (account = ? AND bookedOn >= ? AND bookedOn <= ?) OR utr IN (${rows.map(() => "?").join(",") || "''"})`,
      [account, addDays(fromDate, -1), addDays(toDate, 1), ...rows.map((r) => parseNarration(r.description, r.ref).utr ?? "-")])
      .map(({ bookedOn, ...h }) => ({ ...h, date: bookedOn, amountPaise: n(h.amountPaise) }));
    const coverage = new Map(db.engine.all<{ id: string; fromDate: string; toDate: string }>("SELECT id, fromDate, toDate FROM finImport WHERE account = ? AND fromDate IS NOT NULL", [account]).map((i) => [i.id, { from: i.fromDate, to: i.toDate }]));
    const taken = new Set<string>();
    let added = 0, duplicates = 0, review = 0;
    for (const r of withOccurrence(rows)) {
      const fp = rowFingerprint(account, r, r.n);
      if (db.engine.all("SELECT 1 FROM finSource WHERE source = ? AND sourceRef = ?", [source, fp]).length) { duplicates++; continue; }
      const nar = parseNarration(r.description, r.ref);
      const t = { account, direction: r.amount > 0 ? "credit" as const : "debit" as const, amountPaise: Math.abs(r.amount), date: r.date, utr: nar.utr, description: r.description };
      const c = classify(t, have, taken, coverage, importId);
      if (c.kind === "same") {
        taken.add(c.id);
        db.from("finSource").insert({ id: `src-${fp}`, txnId: c.id, source, sourceRef: fp, importId, row: r.row, rule: c.rule === 2 ? "utr" : "attributes", at });
        duplicates++;
        continue;
      }
      const id = `st-${fp}`;
      db.from("finTxn").insert({
        id, account, direction: t.direction, amountPaise: t.amountPaise, bookedOn: r.date, bookedTime: r.time, description: r.description, refText: r.ref || null,
        utr: nar.utr, channel: nar.channel, counterpartyName: nar.name, counterpartyVpa: nar.vpa, balancePaise: r.balance, source, importId, verified: 0, at,
      });
      db.from("finSource").insert({ id: `src-${fp}`, txnId: id, source, sourceRef: fp, importId, row: r.row, rule: "new", at });
      have.push({ ...t, id, importId });
      added++;
      if (c.kind === "review") {
        taken.add(c.id);
        db.from("finEvent").insert({ txnId: id, kind: "duplicate", refId: c.id, note: "Same day and amount as a row from another file", userId: SYSTEM, at });
        review++;
      }
    }
    db.from("finImport").insert({ id: importId, account, fileName: input.fileName.slice(0, 120), rows: rows.length, added, duplicates, review, skipped, problems: JSON.stringify(problems.slice(0, 200)), fromDate, toDate, matched: 0, userId: input.userId, at });
    if (input.mapping && !bankAutoMapping(t)) db.setMeta(`fin:map:${a.bank}`, JSON.stringify(input.mapping));
    return { importId, rows: rows.length, added, duplicates, review, skipped, problems: problems.slice(0, 200), matched: 0 };
  });
  result.matched = autoReconcile(db, input.userId);
  return result;
}

export function importHistory(db: DriveDB, limit = 50) {
  return db.engine.all<{ id: string; account: string; fileName: string; rows: number; added: number; duplicates: number; review: number; skipped: number; problems: string; fromDate: string | null; toDate: string | null; userId: string; at: string }>(
    "SELECT * FROM finImport ORDER BY at DESC LIMIT ?", [limit])
    .map((i) => ({ ...i, accountLabel: accountLabel(i.account), problems: JSON.parse(i.problems) as RowProblem[] }));
}

// ---------- state of a transaction ----------

type TxnRow = { id: string; account: string; direction: "credit" | "debit"; amountPaise: number; bookedOn: string; bookedTime: string | null; description: string; refText: string | null; utr: string | null; channel: Channel; counterpartyName: string | null; counterpartyVpa: string | null; source: string; importId: string | null; verified: number };
export type TxnState = "matched" | "partial" | "unmatched" | "review" | "duplicate" | "ignored" | "debit" | "not_payment";

/** Latest decision of each kind per transaction (events are append-only; the last one counts). */
function decisions(db: DriveDB) {
  const dup = new Map<string, string>(), ign = new Map<string, boolean>(), rejected = new Set<string>();
  for (const e of db.engine.all<{ txnId: string; kind: string; refId: string | null }>("SELECT txnId, kind, refId FROM finEvent ORDER BY at, id")) {
    if (e.kind === "duplicate" || e.kind === "same_as" || e.kind === "not_duplicate") dup.set(e.txnId, e.kind);
    else if (e.kind === "ignore" || e.kind === "unignore") ign.set(e.txnId, e.kind === "ignore");
    else if (e.kind === "reject" && e.refId) rejected.add(`${e.txnId}|${e.refId}`);
  }
  return { dup, ign, rejected };
}

function allocatedByTxn(db: DriveDB) {
  return new Map(db.engine.all<{ txnId: string; s: number }>("SELECT txnId, SUM(amountPaise) AS s FROM finAllocation GROUP BY txnId").map((r) => [r.txnId, n(r.s)]));
}

function stateOf(t: TxnRow, d: ReturnType<typeof decisions>, alloc: number): TxnState {
  const dup = d.dup.get(t.id);
  if (dup === "same_as") return "duplicate";
  if (dup === "duplicate") return "review";
  if (d.ign.get(t.id)) return "ignored";
  if (t.direction === "debit") return "debit";
  if (alloc >= n(t.amountPaise)) return "matched";
  if (alloc > 0) return "partial";
  if (NOT_PAYMENTS.includes(t.channel)) return "not_payment";
  return "unmatched";
}

// ---------- what credits can pay ----------

/**
 * Credit bills with what is still due on each. Bank matches are tied to a bill; receipts taken at the counter
 * without a bill pay the customer's oldest bills first.
 */
export function openBills(db: DriveDB, includePaid = false): (OpenBill & { creditPaise: number; paidPaise: number })[] {
  const bills = db.engine.all<{ saleId: string; invoiceNo: string; customerId: string; customerName: string; at: string; credit: number; returned: number; tied: number }>(
    `SELECT s.id AS saleId, s.invoiceNo, s.customerId, c.name AS customerName, s.at,
            (SELECT SUM(amountPaise) FROM payment WHERE saleId = s.id AND mode = 'credit') AS credit,
            (SELECT COALESCE(SUM(amountPaise - pointsValuePaise), 0) FROM salesReturn WHERE saleId = s.id AND refundMode = 'credit') AS returned,
            (SELECT COALESCE(SUM(amountPaise), 0) FROM finAllocation WHERE saleId = s.id AND target = 'bill') AS tied
       FROM sale s JOIN customer c ON c.id = s.customerId
      WHERE EXISTS (SELECT 1 FROM payment WHERE saleId = s.id AND mode = 'credit') ORDER BY s.at, s.invoiceNo`);
  const pool = new Map(db.engine.all<{ customerId: string; s: number }>(
    `SELECT customerId, SUM(amountPaise) AS s FROM customerReceipt
      WHERE id NOT IN (SELECT receiptId FROM finAllocation WHERE target = 'bill' AND receiptId IS NOT NULL) GROUP BY customerId`).map((r) => [r.customerId, n(r.s)]));
  const out = [];
  for (const b of bills) {
    let bal = n(b.credit) - n(b.returned) - n(b.tied);
    const free = pool.get(b.customerId) ?? 0;
    const use = Math.max(0, Math.min(free, bal));
    pool.set(b.customerId, free - use);
    bal -= use;
    if (bal > 0 || includePaid) out.push({ saleId: b.saleId, invoiceNo: b.invoiceNo, customerId: b.customerId, customerName: b.customerName, date: istDate(new Date(b.at)), balancePaise: Math.max(0, bal), creditPaise: n(b.credit), paidPaise: n(b.credit) - n(b.returned) - Math.max(0, bal) });
  }
  return out;
}

/** UPI taken at the counter (whole or split bills) not yet confirmed by the bank, last 120 days. */
export function unverifiedCounterUpi(db: DriveDB, today = todayISO()): CounterUpi[] {
  return db.engine.all<{ paymentId: string; saleId: string; invoiceNo: string; amountPaise: number; at: string; ref: string | null; done: number }>(
    `SELECT p.id AS paymentId, s.id AS saleId, s.invoiceNo, p.amountPaise, s.at, p.ref,
            (SELECT COALESCE(SUM(amountPaise), 0) FROM finAllocation WHERE paymentId = p.id) AS done
       FROM payment p JOIN sale s ON s.id = p.saleId WHERE p.mode = 'upi' AND s.at >= ? ORDER BY s.at`, [new Date(Date.parse(addDays(today, -120))).toISOString()])
    .filter((p) => n(p.done) < n(p.amountPaise))
    .map((p) => ({ paymentId: p.paymentId, saleId: p.saleId, invoiceNo: p.invoiceNo, amountPaise: n(p.amountPaise) - n(p.done), date: istDate(new Date(p.at)), ref: p.ref }));
}

/** UPI / bank receipts typed at the counter (not made by a bank match) and not yet confirmed by the bank. */
export function unverifiedReceipts(db: DriveDB, today = todayISO()): LooseReceipt[] {
  return db.engine.all<{ receiptId: string; customerId: string; customerName: string; amountPaise: number; at: string; ref: string | null; done: number }>(
    `SELECT r.id AS receiptId, r.customerId, c.name AS customerName, r.amountPaise, r.at, r.ref,
            (SELECT COALESCE(SUM(amountPaise), 0) FROM finAllocation WHERE receiptId = r.id AND target = 'receipt') AS done
       FROM customerReceipt r JOIN customer c ON c.id = r.customerId
      WHERE r.mode IN ('upi', 'bank') AND r.amountPaise > 0 AND r.id NOT LIKE 'bk-%' AND r.at >= ?`, [new Date(Date.parse(addDays(today, -120))).toISOString()])
    .filter((r) => n(r.done) < n(r.amountPaise))
    .map((r) => ({ receiptId: r.receiptId, customerId: r.customerId, customerName: r.customerName, amountPaise: n(r.amountPaise) - n(r.done), date: istDate(new Date(r.at)), ref: r.ref }));
}

function openCredits(db: DriveDB): (CreditIn & { row: TxnRow })[] {
  const d = decisions(db), alloc = allocatedByTxn(db);
  return db.engine.all<TxnRow>("SELECT * FROM finTxn WHERE direction = 'credit' ORDER BY bookedOn, id")
    .filter((t) => { const s = stateOf(t, d, alloc.get(t.id) ?? 0); return s === "unmatched" || s === "partial"; })
    .map((t) => ({ id: t.id, remainingPaise: n(t.amountPaise) - (alloc.get(t.id) ?? 0), date: t.bookedOn, description: `${t.description} ${t.refText ?? ""}`, utr: t.utr, vpa: t.counterpartyVpa, row: t }));
}

function matchData(db: DriveDB): MatchData {
  const known = new Map<string, string>();
  for (const k of db.engine.all<{ vpa: string; customerId: string }>(
    `SELECT t.counterpartyVpa AS vpa, a.customerId FROM finAllocation a JOIN finTxn t ON t.id = a.txnId
      WHERE a.target = 'bill' AND a.kind IN ('approved', 'manual') AND a.amountPaise > 0 AND t.counterpartyVpa IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM finAllocation r WHERE r.reversesId = a.id) ORDER BY a.at`)) known.set(k.vpa, k.customerId);
  return { bills: openBills(db), counter: unverifiedCounterUpi(db), receipts: unverifiedReceipts(db), rejected: decisions(db).rejected, knownPayers: known, autoKnownPayers: finSettings(db).autoKnownPayers };
}

// ---------- recording matches ----------

const allocInput = z.object({
  txnId: z.string().min(1), target: z.enum(["bill", "counter", "receipt"]), targetId: z.string().min(1),
  amountPaise: z.number().int().positive(), kind: z.enum(["auto", "approved", "manual"]), rule: z.number().int().min(1).max(5).nullable(), userId: z.string().min(1),
});

/** Ties (part of) a credit to a bill, a counter UPI payment or a recorded receipt. Checks every amount first. */
export function allocate(db: DriveDB, input: z.input<typeof allocInput>) {
  const a = allocInput.parse(input);
  return db.transaction(() => {
    const t = db.engine.all<TxnRow>("SELECT * FROM finTxn WHERE id = ?", [a.txnId])[0];
    if (!t) throw new CounterError("Bank transaction not found.");
    const st = stateOf(t, decisions(db), allocatedByTxn(db).get(t.id) ?? 0);
    if (t.direction !== "credit") throw new CounterError("Only money received can be matched to bills.");
    if (st === "duplicate" || st === "review" || st === "ignored") throw new CounterError(st === "review" ? "Decide whether this is a duplicate first." : "This transaction is set aside. Bring it back first.");
    const remaining = n(t.amountPaise) - (allocatedByTxn(db).get(t.id) ?? 0);
    if (a.amountPaise > remaining) throw new CounterError(`Only ₹${(remaining / 100).toFixed(2)} of this payment is left to match.`);
    const nth = n(db.engine.all<{ c: number }>("SELECT COUNT(*) AS c FROM finAllocation WHERE txnId = ? AND (saleId = ?2 OR paymentId = ?2 OR receiptId = ?2)", [a.txnId, a.targetId])[0]?.c) + 1;
    const id = `al-${a.txnId}-${a.targetId}-${nth}`.slice(0, 160);
    const at = now();
    if (a.target === "bill") {
      const b = openBills(db).find((x) => x.saleId === a.targetId);
      if (!b) throw new CounterError("That bill has nothing left to pay.");
      if (a.amountPaise > b.balancePaise) throw new CounterError(`${b.invoiceNo} has only ₹${(b.balancePaise / 100).toFixed(2)} left to pay.`);
      const receiptId = `bk-${id.slice(3)}`;
      db.from("customerReceipt").insert({ id: receiptId, customerId: b.customerId, amountPaise: a.amountPaise, mode: t.channel === "upi" ? "upi" : "bank", ref: `Bank ${t.utr ?? t.bookedOn} for ${b.invoiceNo}`.slice(0, 120), userId: a.userId, at });
      db.from("finAllocation").insert({ id, txnId: t.id, target: "bill", saleId: b.saleId, customerId: b.customerId, receiptId, amountPaise: a.amountPaise, kind: a.kind, rule: a.rule, userId: a.userId, at });
    } else if (a.target === "counter") {
      const p = unverifiedCounterUpi(db).find((x) => x.paymentId === a.targetId);
      if (!p) throw new CounterError("That counter payment is already confirmed.");
      if (a.amountPaise > p.amountPaise) throw new CounterError(`That counter payment was ₹${(p.amountPaise / 100).toFixed(2)}.`);
      db.from("finAllocation").insert({ id, txnId: t.id, target: "counter", saleId: p.saleId, paymentId: p.paymentId, amountPaise: a.amountPaise, kind: a.kind, rule: a.rule, userId: a.userId, at });
    } else {
      const r = unverifiedReceipts(db).find((x) => x.receiptId === a.targetId);
      if (!r) throw new CounterError("That receipt is already confirmed.");
      if (a.amountPaise > r.amountPaise) throw new CounterError(`That receipt was ₹${(r.amountPaise / 100).toFixed(2)}.`);
      db.from("finAllocation").insert({ id, txnId: t.id, target: "receipt", receiptId: r.receiptId, customerId: r.customerId, amountPaise: a.amountPaise, kind: a.kind, rule: a.rule, userId: a.userId, at });
    }
    return { id };
  });
}

/** Undoes a match: a negative allocation (and a negative receipt for a bill), and the pair is not suggested again. */
export function unallocate(db: DriveDB, allocationId: string, userId: string) {
  return db.transaction(() => {
    const a = db.engine.all<{ id: string; txnId: string; target: Target; saleId: string | null; paymentId: string | null; receiptId: string | null; customerId: string | null; amountPaise: number; kind: string }>(
      "SELECT * FROM finAllocation WHERE id = ?", [allocationId])[0];
    if (!a || a.kind === "reversal" || n(a.amountPaise) <= 0) throw new CounterError("Match not found.");
    if (db.engine.all("SELECT 1 FROM finAllocation WHERE reversesId = ?", [a.id]).length) throw new CounterError("This match was already undone.");
    const at = now(), id = `rv-${a.id}`.slice(0, 160);
    let receiptId = a.target === "receipt" ? a.receiptId : null;
    if (a.target === "bill" && a.receiptId && a.customerId) {
      receiptId = `rv-${a.receiptId}`.slice(0, 160);
      const r = db.engine.all<{ mode: string }>("SELECT mode FROM customerReceipt WHERE id = ?", [a.receiptId])[0];
      db.from("customerReceipt").insert({ id: receiptId, customerId: a.customerId, amountPaise: -n(a.amountPaise), mode: r?.mode ?? "bank", ref: "Bank match undone", userId, at });
    }
    db.from("finAllocation").insert({ id, txnId: a.txnId, target: a.target, saleId: a.saleId, paymentId: a.paymentId, receiptId, customerId: a.customerId, amountPaise: -n(a.amountPaise), kind: "reversal", rule: null, reversesId: a.id, userId, at });
    db.from("finEvent").insert({ txnId: a.txnId, kind: "reject", refId: a.paymentId ?? (a.target === "bill" ? a.saleId : a.receiptId), note: "Match undone", userId, at });
    return { id };
  });
}

/** Records every automatic proposal that still holds. Returns how many credits were matched. */
export function autoReconcile(db: DriveDB, userId: string) {
  let total = 0;
  for (let pass = 0; pass < 4; pass++) {
    const credits = openCredits(db);
    if (!credits.length) break;
    const props = propose(credits.filter((c) => !NOT_PAYMENTS.includes(c.row.channel)), matchData(db));
    let made = 0;
    for (const ps of props.values()) {
      const p = ps.find((x) => x.auto);
      if (!p) continue;
      try { allocate(db, { txnId: p.txnId, target: p.target, targetId: p.targetId, amountPaise: p.amountPaise, kind: "auto", rule: p.rule, userId }); made++; }
      catch (e) { if (!(e instanceof CounterError)) throw e; /* the bill or payment changed in this pass: next pass re-checks */ }
    }
    total += made;
    if (!made) break;
  }
  return total;
}

/** Approves one suggestion as proposed (amount included). */
export function approveSuggestion(db: DriveDB, txnId: string, targetId: string, userId: string) {
  const p = suggestionsFor(db, txnId).find((x) => x.targetId === targetId);
  if (!p) throw new CounterError("That suggestion no longer fits. Refresh and look again.");
  return allocate(db, { txnId, target: p.target, targetId, amountPaise: p.amountPaise, kind: "approved", rule: p.rule, userId });
}

/** Approves every suggestion that is the only candidate both ways (rule 4). */
export function approveAllUnique(db: DriveDB, userId: string) {
  let n = 0;
  for (const [, ps] of allSuggestions(db)) {
    const p = ps.find((x) => x.rule === 4);
    if (!p) continue;
    try { allocate(db, { txnId: p.txnId, target: p.target, targetId: p.targetId, amountPaise: p.amountPaise, kind: "approved", rule: 4, userId }); n++; }
    catch (e) { if (!(e instanceof CounterError)) throw e; }
  }
  return n;
}

export function rejectSuggestion(db: DriveDB, txnId: string, targetId: string, userId: string) {
  db.from("finEvent").insert({ txnId, kind: "reject", refId: targetId, note: null, userId, at: now() });
  return true;
}

const manualInput = z.object({ txnId: z.string().min(1), target: z.enum(["bill", "counter", "receipt"]), targetId: z.string().min(1), amountPaise: z.number().int().positive("Enter the amount."), userId: z.string().min(1) });
/** A person ties a credit to a bill (or payment, or receipt) of their choosing. */
export function manualMatch(db: DriveDB, input: z.input<typeof manualInput>) {
  const m = manualInput.parse(input);
  return allocate(db, { ...m, kind: "manual", rule: null });
}

/** Duplicate review: "same" sets this row aside as a copy of the other; "different" keeps both. */
export function resolveDuplicate(db: DriveDB, txnId: string, same: boolean, userId: string) {
  return db.transaction(() => {
    const open = decisions(db).dup.get(txnId);
    if (open !== "duplicate") throw new CounterError("This transaction isn’t waiting for a duplicate decision.");
    if (same && n(allocatedByTxn(db).get(txnId)) > 0) throw new CounterError("Undo its matches first.");
    const ref = db.engine.all<{ refId: string }>("SELECT refId FROM finEvent WHERE txnId = ? AND kind = 'duplicate' ORDER BY at DESC LIMIT 1", [txnId])[0]?.refId ?? null;
    db.from("finEvent").insert({ txnId, kind: same ? "same_as" : "not_duplicate", refId: ref, note: null, userId, at: now() });
    if (!same) autoReconcile(db, userId);
    return true;
  });
}

/** Sets a transaction aside (e.g. the owner's own transfer) or brings it back. */
export function setIgnored(db: DriveDB, txnId: string, ignored: boolean, note: string, userId: string) {
  return db.transaction(() => {
    if (!db.engine.all("SELECT 1 FROM finTxn WHERE id = ?", [txnId]).length) throw new CounterError("Bank transaction not found.");
    if (ignored && n(allocatedByTxn(db).get(txnId)) > 0) throw new CounterError("Undo its matches first.");
    db.from("finEvent").insert({ txnId, kind: ignored ? "ignore" : "unignore", refId: null, note: note.trim().slice(0, 120) || null, userId, at: now() });
    return true;
  });
}

// ---------- screens ----------

function allSuggestions(db: DriveDB) {
  const credits = openCredits(db).filter((c) => !NOT_PAYMENTS.includes(c.row.channel));
  return propose(credits, matchData(db));
}
export function suggestionsFor(db: DriveDB, txnId: string): Proposal[] { return allSuggestions(db).get(txnId) ?? []; }

const txnView = (t: TxnRow, state: TxnState, allocated: number) => ({
  id: t.id, account: t.account, accountLabel: accountLabel(t.account), direction: t.direction, amountPaise: n(t.amountPaise), allocatedPaise: allocated,
  date: t.bookedOn, time: t.bookedTime, description: t.description, ref: t.refText, utr: t.utr, channel: t.channel,
  counterpartyName: t.counterpartyName, counterpartyVpa: t.counterpartyVpa, source: t.source.startsWith("statement:") ? "Statement" : t.source, verified: !!t.verified, state,
});
export type TxnView = ReturnType<typeof txnView>;

const listInput = z.object({
  q: z.string().trim().max(60).optional(), state: z.string().max(20).optional(), direction: z.enum(["credit", "debit"]).optional(),
  account: z.string().max(40).optional(), from: z.string().optional(), to: z.string().optional(), limit: z.number().int().min(1).max(2000).optional(),
});
export function transactions(db: DriveDB, filter: z.input<typeof listInput> = {}) {
  const f = listInput.parse(filter);
  const d = decisions(db), alloc = allocatedByTxn(db);
  const where: string[] = [], params: (string | number)[] = [];
  if (f.direction) { where.push("direction = ?"); params.push(f.direction); }
  if (f.account) { where.push("account = ?"); params.push(f.account); }
  if (f.from) { where.push("bookedOn >= ?"); params.push(f.from); }
  if (f.to) { where.push("bookedOn <= ?"); params.push(f.to); }
  if (f.q) { where.push("(description LIKE ? OR utr LIKE ? OR counterpartyName LIKE ? OR counterpartyVpa LIKE ? OR CAST(amountPaise / 100 AS TEXT) = ?)"); const like = `%${f.q.replace(/[%_]/g, "")}%`; params.push(like, like, like, like, f.q.replace(/[^\d]/g, "")); }
  const rows = db.engine.all<TxnRow>(`SELECT * FROM finTxn${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY bookedOn DESC, bookedTime DESC, id LIMIT 5000`, params);
  const views = rows.map((t) => txnView(t, stateOf(t, d, alloc.get(t.id) ?? 0), alloc.get(t.id) ?? 0)).filter((v) => !f.state || v.state === f.state);
  const links = linksFor(db, views.slice(0, f.limit ?? 500).map((v) => v.id));
  return views.slice(0, f.limit ?? 500).map((v) => ({ ...v, links: links.get(v.id) ?? [] }));
}

/** What each transaction is matched to (net of undone matches). */
function linksFor(db: DriveDB, ids: string[]) {
  const out = new Map<string, { allocationId: string; target: Target; label: string; amountPaise: number; kind: string; rule: number | null }[]>();
  if (!ids.length) return out;
  const rows = db.engine.all<{ id: string; txnId: string; target: Target; amountPaise: number; kind: string; rule: number | null; invoiceNo: string | null; customerName: string | null }>(
    `SELECT a.id, a.txnId, a.target, a.amountPaise, a.kind, a.rule, s.invoiceNo, c.name AS customerName FROM finAllocation a
       LEFT JOIN sale s ON s.id = a.saleId LEFT JOIN customer c ON c.id = a.customerId
      WHERE a.txnId IN (${ids.map(() => "?").join(",")}) AND a.kind <> 'reversal' AND NOT EXISTS (SELECT 1 FROM finAllocation r WHERE r.reversesId = a.id) ORDER BY a.at`, ids);
  for (const r of rows) {
    const label = r.target === "bill" ? `${r.invoiceNo} · ${r.customerName}` : r.target === "counter" ? `Counter UPI · ${r.invoiceNo}` : `Receipt · ${r.customerName}`;
    out.set(r.txnId, [...(out.get(r.txnId) ?? []), { allocationId: r.id, target: r.target, label, amountPaise: n(r.amountPaise), kind: r.kind, rule: r.rule }]);
  }
  return out;
}

export function transactionDetail(db: DriveDB, id: string) {
  const t = transactions(db, { limit: 2000 }).find((x) => x.id === id);
  if (!t) throw new CounterError("Bank transaction not found.");
  const sources = db.engine.all<{ source: string; sourceRef: string; row: number | null; rule: string; at: string; fileName: string | null }>(
    "SELECT s.source, s.sourceRef, s.row, s.rule, s.at, i.fileName FROM finSource s LEFT JOIN finImport i ON i.id = s.importId WHERE s.txnId = ? ORDER BY s.at", [id]);
  const events = db.engine.all<{ kind: string; refId: string | null; note: string | null; userId: string; at: string }>("SELECT kind, refId, note, userId, at FROM finEvent WHERE txnId = ? ORDER BY at", [id]);
  return { ...t, sources, events, suggestions: suggestionsFor(db, id) };
}

/** Statement dates covered, per account. */
function coverage(db: DriveDB) {
  return db.engine.all<{ account: string; fromDate: string; toDate: string }>("SELECT account, MIN(fromDate) AS fromDate, MAX(toDate) AS toDate FROM finImport WHERE fromDate IS NOT NULL GROUP BY account");
}

/**
 * Counter UPI the bank should already show but doesn't: bills from days a statement covers, with a day's grace for
 * late posting. A UPI "payment successful" screen is not proof of payment; the statement is.
 */
export function counterNotSeen(db: DriveDB) {
  const cov = coverage(db);
  if (!cov.length) return [];
  return unverifiedCounterUpi(db).filter((p) => cov.some((c) => c.fromDate <= p.date && addDays(p.date, COUNTER_WINDOW_DAYS - 1) <= c.toDate));
}

/** The reconciliation queues. */
export function reconciliation(db: DriveDB) {
  const d = decisions(db), alloc = allocatedByTxn(db);
  const all = db.engine.all<TxnRow>("SELECT * FROM finTxn ORDER BY bookedOn DESC, id").map((t) => txnView(t, stateOf(t, d, alloc.get(t.id) ?? 0), alloc.get(t.id) ?? 0));
  const sugg = allSuggestions(db);
  const withSugg = all.filter((t) => (t.state === "unmatched" || t.state === "partial") && (sugg.get(t.id)?.length ?? 0) > 0);
  const recentAuto = db.engine.all<{ txnId: string }>("SELECT DISTINCT a.txnId FROM finAllocation a WHERE a.kind = 'auto' AND NOT EXISTS (SELECT 1 FROM finAllocation r WHERE r.reversesId = a.id) ORDER BY a.at DESC LIMIT 100").map((r) => r.txnId);
  const byId = new Map(all.map((t) => [t.id, t]));
  const ids = [...new Set([...recentAuto, ...withSugg.map((t) => t.id), ...all.filter((t) => t.state === "partial").map((t) => t.id)])];
  const links = linksFor(db, ids);
  const dupOf = new Map(db.engine.all<{ txnId: string; refId: string }>("SELECT txnId, refId FROM finEvent WHERE kind = 'duplicate'").map((e) => [e.txnId, e.refId]));
  const bills = openBills(db, true);
  return {
    auto: recentAuto.map((id) => byId.get(id)).filter(Boolean).map((t) => ({ ...t!, links: links.get(t!.id) ?? [] })),
    suggested: withSugg.map((t) => ({ ...t, links: links.get(t.id) ?? [], suggestions: sugg.get(t.id)! })),
    unmatched: all.filter((t) => t.state === "unmatched" && !(sugg.get(t.id)?.length)),
    partialTxns: all.filter((t) => t.state === "partial").map((t) => ({ ...t, links: links.get(t.id) ?? [] })),
    partialBills: bills.filter((b) => b.paidPaise > 0 && b.balancePaise > 0),
    duplicates: all.filter((t) => t.state === "review").map((t) => ({ ...t, other: byId.get(dupOf.get(t.id) ?? "") ?? null })),
    counterNotSeen: counterNotSeen(db),
    openBills: bills.filter((b) => b.balancePaise > 0).map((b) => ({ ...b, medoroRef: medoroRef(b.invoiceNo) })),
    counterUnverified: unverifiedCounterUpi(db),
    receiptsUnverified: unverifiedReceipts(db),
  };
}

/** The overview cards. Amounts are for the last `days` days of statement dates. */
export function overview(db: DriveDB, days = 30, today = todayISO()) {
  const from = addDays(today, -days + 1);
  const d = decisions(db), alloc = allocatedByTxn(db);
  const txns = db.engine.all<TxnRow>("SELECT * FROM finTxn WHERE bookedOn >= ?", [from]).map((t) => ({ t, s: stateOf(t, d, alloc.get(t.id) ?? 0) })).filter((x) => x.s !== "duplicate");
  const credits = txns.filter((x) => x.t.direction === "credit" && x.s !== "ignored");
  const sum = (xs: typeof txns) => xs.reduce((a, x) => a + n(x.t.amountPaise), 0);
  const allStates = db.engine.all<TxnRow>("SELECT * FROM finTxn").map((t) => stateOf(t, d, alloc.get(t.id) ?? 0));
  const last = db.engine.all<{ at: string; fileName: string; account: string; toDate: string | null }>("SELECT at, fileName, account, toDate FROM finImport ORDER BY at DESC LIMIT 1")[0] ?? null;
  return {
    days, from, to: today,
    upiCreditsPaise: sum(credits.filter((x) => x.t.channel === "upi")), upiCredits: credits.filter((x) => x.t.channel === "upi").length,
    bankCreditsPaise: sum(credits), bankCredits: credits.length,
    matched: allStates.filter((s) => s === "matched").length, partial: allStates.filter((s) => s === "partial").length,
    unmatched: allStates.filter((s) => s === "unmatched").length, review: allStates.filter((s) => s === "review").length,
    counterNotSeen: counterNotSeen(db).length, counterUnverified: unverifiedCounterUpi(db).length,
    accounts: coverage(db).map((c) => ({ ...c, label: accountLabel(c.account), transactions: n(db.engine.all<{ c: number }>("SELECT COUNT(*) AS c FROM finTxn WHERE account = ?", [c.account])[0]?.c) })),
    lastImport: last ? { ...last, accountLabel: accountLabel(last.account) } : null,
  };
}

/** Reports for a date range: credits by day, by month, by account and by channel, plus the reconciliation summary. */
export function finReports(db: DriveDB, from: string, to: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || from > to) throw new CounterError("Pick a valid date range.");
  const d = decisions(db), alloc = allocatedByTxn(db);
  const rows = db.engine.all<TxnRow>("SELECT * FROM finTxn WHERE bookedOn >= ? AND bookedOn <= ? ORDER BY bookedOn", [from, to])
    .map((t) => txnView(t, stateOf(t, d, alloc.get(t.id) ?? 0), alloc.get(t.id) ?? 0)).filter((t) => t.state !== "duplicate" && t.state !== "ignored");
  const credits = rows.filter((t) => t.direction === "credit");
  const group = <K extends string>(key: (t: TxnView) => K) => {
    const m = new Map<K, { key: K; count: number; totalPaise: number; upiPaise: number; matchedPaise: number }>();
    for (const t of credits) {
      const k = key(t), g = m.get(k) ?? { key: k, count: 0, totalPaise: 0, upiPaise: 0, matchedPaise: 0 };
      g.count++; g.totalPaise += t.amountPaise; if (t.channel === "upi") g.upiPaise += t.amountPaise; g.matchedPaise += Math.max(0, t.allocatedPaise);
      m.set(k, g);
    }
    return [...m.values()].sort((a, b) => (a.key < b.key ? -1 : 1));
  };
  return {
    from, to,
    daily: group((t) => t.date), monthly: group((t) => t.date.slice(0, 7)),
    byAccount: group((t) => t.accountLabel), byChannel: group((t) => t.channel),
    unmatched: credits.filter((t) => t.state === "unmatched" || t.state === "partial"),
    reconciliation: rows,
    totals: { credits: credits.length, creditPaise: credits.reduce((a, t) => a + t.amountPaise, 0), debitPaise: rows.filter((t) => t.direction === "debit").reduce((a, t) => a + t.amountPaise, 0), matchedPaise: credits.reduce((a, t) => a + Math.max(0, t.allocatedPaise), 0) },
  };
}
