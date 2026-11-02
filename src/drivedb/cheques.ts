/**
 * Cheques on the device database: received from customers and given to suppliers, post-dated ones included.
 * Same rules as the server (src/domain/parties/cheques.ts):
 *   - Recording the cheque IS the receipt / payment (mode "cheque"): the customer owes less, or the supplier is
 *     owed less, from that moment, as the server credits Debtors / debits Creditors when the cheque is recorded.
 *   - Deposited (received only, not before the cheque date) and cleared (not before the cheque date, not in the
 *     future) are steps only: the party's balance doesn't move again.
 *   - Bounced: a reversing receipt / payment puts the amount back on the party's account, plus any charge
 *     recovered from the customer or penalty the supplier levies; our bank's charge is a Bank charges expense.
 *   - Cancelled (a cheque handed back or stopped before it was presented): reversed the same way, no charges.
 * Every step is a new row (chequeEvent); nothing is edited. Rows a step adds have fixed ids (cheque id + suffix),
 * so if two counters bounce the same cheque while offline, sync keeps one reversal, not two.
 */
import { z } from "zod";
import { DriveDB } from "./client";
import { CounterError } from "./pharmacy";
import { customerBalance } from "./trade";
import { supplierDues } from "./books";
import { addDays, daysTo, istMidnight, todayISO } from "@/lib/dates";

export type ChequeStatus = "pending" | "deposited" | "cleared" | "bounced" | "cancelled";
export type Direction = "received" | "issued";
export const CHEQUE_STATUS: Record<ChequeStatus, string> = { pending: "Pending", deposited: "Deposited", cleared: "Cleared", bounced: "Bounced", cancelled: "Cancelled" };

const n = (v: unknown) => Number(v ?? 0);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-01.");
const charge = z.number().int().min(0, "Charges can’t be negative.").max(1_000_000_00).default(0);
const label = (c: { chequeNo: string; bank: string; chequeDate: string }) => `Cheque ${c.chequeNo} · ${c.bank} · dated ${c.chequeDate}`;
/** A step's time: now when it happened today, else midday of that day (IST). */
const atOf = (day: string, today: string) => (day === today ? new Date().toISOString() : new Date(istMidnight(day).getTime() + 12 * 3600_000).toISOString());
/** A step's date: today when not given; never in the future. */
const dayOf = (v: string | undefined, today: string) => {
  const d = v || today;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) throw new CounterError("Use a date like 2026-11-01.");
  if (d > today) throw new CounterError("The date can’t be in the future.");
  return d;
};
/** Fixed ids of the rows a step adds (see the note at the top). */
const ids = (chequeId: string) => ({ deposit: `${chequeId}-dep`, end: `${chequeId}-end`, reversal: `${chequeId}-rev`, charge: `${chequeId}-chg`, bank: `${chequeId}-bank` });

// ---------- recording ----------

export const chequeInput = z.object({
  direction: z.enum(["received", "issued"]),
  /** The customer (received) or supplier (issued). */
  partyId: z.string().min(1),
  chequeNo: z.string().trim().regex(/^\d{6}$/, "Cheque number is the 6 digits printed on the cheque."),
  bank: z.string().trim().min(2, "Enter the bank the cheque is drawn on.").max(60),
  chequeDate: isoDate,
  amountPaise: z.number().int().min(100, "Enter at least ₹1.").max(10_000_000_00),
  note: z.string().trim().max(60).optional(),
  userId: z.string().min(1),
});

/**
 * Records a cheque from a customer or to a supplier, with its receipt / payment. Post-dated cheques are fine;
 * one more than three months old is stale and refused. Refuses more than the party owes / is owed.
 */
export function recordCheque(db: DriveDB, input: z.input<typeof chequeInput>, today = todayISO()) {
  const c = chequeInput.parse(input);
  const d = daysTo(c.chequeDate, today);
  if (d < -90) throw new CounterError("That cheque is more than three months old (stale). It can’t be deposited.");
  if (d > 365) throw new CounterError("The cheque date is more than a year away. Check the date.");
  return db.transaction(() => {
    const recv = c.direction === "received";
    const party = recv ? "customerId" : "supplierId";
    // The same cheque can't be entered twice, unless the earlier entry bounced or was cancelled (presented again).
    for (const old of db.engine.all<{ id: string }>(`SELECT id FROM cheque WHERE direction = ? AND ${party} = ? AND chequeNo = ?`, [c.direction, c.partyId, c.chequeNo])) {
      const s = statusOf(db, old.id).status;
      if (s !== "bounced" && s !== "cancelled") throw new CounterError(`Cheque ${c.chequeNo} is already recorded for this party.`);
    }
    const id = globalThis.crypto.randomUUID(), linkId = `${id}-pay`, at = new Date().toISOString();
    const ref = label(c) + (c.note ? ` · ${c.note}` : "");
    if (recv) {
      const cu = db.from<{ id: string; name: string }>("customer").eq("id", c.partyId).first();
      if (!cu) throw new CounterError("Customer not found.");
      const due = customerBalance(db, cu.id);
      if (c.amountPaise > due) throw new CounterError(`${cu.name} owes only ₹${(due / 100).toFixed(2)}.`);
      db.from("customerReceipt").insert({ id: linkId, customerId: cu.id, amountPaise: c.amountPaise, mode: "cheque", ref, userId: c.userId, at });
    } else {
      const due = supplierDues(db).find((s) => s.id === c.partyId);
      if (!due) throw new CounterError("Supplier not found.");
      if (c.amountPaise > due.duePaise) throw new CounterError(`${due.name} is owed only ₹${(due.duePaise / 100).toFixed(2)}.`);
      db.from("supplierPayment").insert({ id: linkId, supplierId: c.partyId, amountPaise: c.amountPaise, mode: "cheque", ref, userId: c.userId, at });
    }
    db.from("cheque").insert({ id, direction: c.direction, customerId: recv ? c.partyId : null, supplierId: recv ? null : c.partyId, chequeNo: c.chequeNo, bank: c.bank,
      chequeDate: c.chequeDate, amountPaise: c.amountPaise, linkId, note: c.note || null, userId: c.userId, at });
    return { id, status: "pending" as const };
  });
}

// ---------- status ----------

type ChequeRow = { id: string; direction: Direction; customerId: string | null; supplierId: string | null; chequeNo: string; bank: string; chequeDate: string; amountPaise: number; linkId: string; note: string | null; at: string };
type EventRow = { id: string; chequeId: string; kind: Exclude<ChequeStatus, "pending">; day: string; reason: string | null; chargePaise: number; bankChargePaise: number };

/** A cheque's status from its steps. If one counter cleared it and another bounced it while offline, the bounce stands. */
function statusOf(db: DriveDB, chequeId: string, events?: EventRow[], reversed?: boolean) {
  const ev = events ?? db.engine.all<EventRow>("SELECT * FROM chequeEvent WHERE chequeId = ?", [chequeId]);
  const dep = ev.find((e) => e.kind === "deposited") ?? null, end = ev.find((e) => e.kind !== "deposited") ?? null;
  const rev = reversed ?? hasReversal(db, chequeId);
  const conflict = end?.kind === "cleared" && rev;
  const status: ChequeStatus = conflict ? "bounced" : end ? end.kind : dep ? "deposited" : "pending";
  return { status, dep, end, conflict };
}
const hasReversal = (db: DriveDB, chequeId: string) =>
  db.engine.all("SELECT 1 FROM customerReceipt WHERE id = ?1 UNION ALL SELECT 1 FROM supplierPayment WHERE id = ?1", [ids(chequeId).reversal]).length > 0;

function load(db: DriveDB, chequeId: string) {
  const c = db.from<ChequeRow>("cheque").eq("id", chequeId).first();
  if (!c) throw new CounterError("Cheque not found.");
  return { ...c, amountPaise: n(c.amountPaise), ...statusOf(db, c.id) };
}

// ---------- steps ----------

/** Received cheque handed to the bank. Status only: the money isn't in the account yet. */
export function depositCheque(db: DriveDB, chequeId: string, userId: string, today = todayISO()) {
  return db.transaction(() => {
    const c = load(db, chequeId);
    if (c.direction !== "received") throw new CounterError("Only cheques you received are deposited.");
    if (c.status !== "pending") throw new CounterError(`Cheque ${c.chequeNo} is already ${CHEQUE_STATUS[c.status].toLowerCase()}.`);
    if (c.chequeDate > today) throw new CounterError(`Cheque ${c.chequeNo} is post-dated. Deposit it on or after ${c.chequeDate}.`);
    db.from("chequeEvent").insert({ id: ids(c.id).deposit, chequeId: c.id, kind: "deposited", day: today, reason: null, chargePaise: 0, bankChargePaise: 0, userId, at: new Date().toISOString() });
    return { status: "deposited" as const };
  });
}

/** The cheque shows on the bank statement. Status only: the party's balance already moved when it was recorded. */
export function clearCheque(db: DriveDB, chequeId: string, on: string | undefined, userId: string, today = todayISO()) {
  const day = dayOf(on, today);
  return db.transaction(() => {
    const c = load(db, chequeId);
    const from: ChequeStatus = c.direction === "received" ? "deposited" : "pending";
    if (c.status !== from) throw new CounterError(c.direction === "received" && c.status === "pending" ? `Deposit cheque ${c.chequeNo} first.` : `Cheque ${c.chequeNo} is ${CHEQUE_STATUS[c.status].toLowerCase()}.`);
    if (day < c.chequeDate) throw new CounterError(`A cheque dated ${c.chequeDate} can’t clear before that date.`);
    db.from("chequeEvent").insert({ id: ids(c.id).end, chequeId: c.id, kind: "cleared", day, reason: null, chargePaise: 0, bankChargePaise: 0, userId, at: atOf(day, today) });
    return { status: "cleared" as const };
  });
}

/** Puts the cheque's amount (and any charge) back on the party's account with new rows. */
function reverse(db: DriveDB, c: ReturnType<typeof load>, why: string, chargePaise: number, userId: string, at: string) {
  const k = ids(c.id);
  if (c.direction === "received") {
    db.from("customerReceipt").insert({ id: k.reversal, customerId: c.customerId, amountPaise: -c.amountPaise, mode: "cheque", ref: why.slice(0, 120), userId, at });
    if (chargePaise) db.from("customerReceipt").insert({ id: k.charge, customerId: c.customerId, amountPaise: -chargePaise, mode: "cheque", ref: `Cheque ${c.chequeNo} return charges`, userId, at });
  } else {
    db.from("supplierPayment").insert({ id: k.reversal, supplierId: c.supplierId, amountPaise: -c.amountPaise, mode: "cheque", ref: why.slice(0, 120), userId, at });
    if (chargePaise) db.from("supplierPayment").insert({ id: k.charge, supplierId: c.supplierId, amountPaise: -chargePaise, mode: "cheque", ref: `Cheque ${c.chequeNo} return charges (supplier’s penalty)`, userId, at });
  }
}

export const bounceInput = z.object({
  chequeId: z.string().min(1),
  reason: z.string().trim().min(3, "Enter the bank’s return reason (e.g. funds insufficient).").max(120),
  /** Charge recovered from the customer, or penalty the supplier levies on us. */
  chargePaise: charge,
  /** What our bank deducted for the return (booked as a Bank charges expense). */
  bankChargePaise: charge,
  on: z.string().optional(),
  branchId: z.string().min(1),
  userId: z.string().min(1),
});

/**
 * Cheque returned unpaid. The customer owes the amount again (plus a charge recovered from them), or we owe the
 * supplier again (plus their penalty). Our bank's charge is an expense. A received cheque can bounce before or after
 * it was deposited; an issued one while it hasn't cleared.
 */
export function bounceCheque(db: DriveDB, input: z.input<typeof bounceInput>, today = todayISO()) {
  const i = bounceInput.parse(input);
  const day = dayOf(i.on, today);
  return db.transaction(() => {
    const c = load(db, i.chequeId);
    if (c.direction === "received" ? !["pending", "deposited"].includes(c.status) : c.status !== "pending") throw new CounterError(`Cheque ${c.chequeNo} is ${CHEQUE_STATUS[c.status].toLowerCase()}; it can’t bounce now.`);
    const at = atOf(day, today);
    reverse(db, c, `Cheque ${c.chequeNo} bounced · ${i.reason}`, i.chargePaise, i.userId, at);
    if (i.bankChargePaise) db.from("expense").insert({ id: ids(c.id).bank, branchId: i.branchId, category: "Bank charges", amountPaise: i.bankChargePaise, mode: "bank", note: `Cheque ${c.chequeNo} returned`, userId: i.userId, at });
    db.from("chequeEvent").insert({ id: ids(c.id).end, chequeId: c.id, kind: "bounced", day, reason: i.reason, chargePaise: i.chargePaise, bankChargePaise: i.bankChargePaise, userId: i.userId, at });
    return { status: "bounced" as const, owedPaise: c.amountPaise + i.chargePaise };
  });
}

export const cancelInput = z.object({
  chequeId: z.string().min(1),
  reason: z.string().trim().min(3, "Say why the cheque is cancelled.").max(120),
  userId: z.string().min(1),
});

/**
 * A cheque that was never presented: handed back to the customer, or stopped / taken back from the supplier.
 * The receipt or payment is reversed with new rows, no charges.
 */
export function cancelCheque(db: DriveDB, input: z.input<typeof cancelInput>, today = todayISO()) {
  const i = cancelInput.parse(input);
  return db.transaction(() => {
    const c = load(db, i.chequeId);
    if (c.status !== "pending") throw new CounterError(c.status === "deposited" ? `Cheque ${c.chequeNo} is already with the bank. Mark it cleared or bounced.` : `Cheque ${c.chequeNo} is ${CHEQUE_STATUS[c.status].toLowerCase()}.`);
    const at = new Date().toISOString();
    reverse(db, c, `Cheque ${c.chequeNo} cancelled · ${i.reason}`, 0, i.userId, at);
    db.from("chequeEvent").insert({ id: ids(c.id).end, chequeId: c.id, kind: "cancelled", day: today, reason: i.reason, chargePaise: 0, bankChargePaise: 0, userId: i.userId, at });
    return { status: "cancelled" as const };
  });
}

// ---------- lists ----------

export type Cheque = {
  id: string; direction: Direction; partyId: string; party: string; chequeNo: string; bank: string; chequeDate: string; days: number; amountPaise: number;
  status: ChequeStatus; note: string | null; depositedOn: string | null; endedOn: string | null; reason: string | null; chargePaise: number; bankChargePaise: number;
  /** Cleared on one counter and bounced on another while offline: the bounce stands; check with the bank. */
  conflict: boolean; at: string;
};

/** Open cheques, plus everything recorded in the last 180 days; cheque date order. */
export function listCheques(db: DriveDB, opts: { open?: boolean } = {}, today = todayISO()): Cheque[] {
  const since = istMidnight(addDays(today, -180)).toISOString();
  const rows = db.engine.all<ChequeRow & { party: string }>(
    `SELECT q.*, COALESCE(c.name, s.name, '') AS party FROM cheque q
       LEFT JOIN customer c ON c.id = q.customerId LEFT JOIN supplier s ON s.id = q.supplierId
      ORDER BY q.chequeDate, q.at`);
  const events = new Map<string, EventRow[]>();
  for (const e of db.engine.all<EventRow>("SELECT * FROM chequeEvent")) events.set(e.chequeId, [...(events.get(e.chequeId) ?? []), e]);
  const reversed = new Set(db.engine.all<{ id: string }>("SELECT id FROM customerReceipt WHERE id LIKE '%-rev' UNION ALL SELECT id FROM supplierPayment WHERE id LIKE '%-rev'").map((r) => r.id));
  const out: Cheque[] = [];
  for (const r of rows) {
    const s = statusOf(db, r.id, events.get(r.id) ?? [], reversed.has(ids(r.id).reversal));
    const open = s.status === "pending" || s.status === "deposited";
    if (opts.open ? !open : !open && r.at < since) continue;
    const bounce = (events.get(r.id) ?? []).find((e) => e.kind === "bounced" || e.kind === "cancelled");
    out.push({
      id: r.id, direction: r.direction, partyId: (r.customerId ?? r.supplierId)!, party: r.party, chequeNo: r.chequeNo, bank: r.bank, chequeDate: r.chequeDate,
      days: daysTo(r.chequeDate, today), amountPaise: n(r.amountPaise), status: s.status, note: r.note, depositedOn: s.dep?.day ?? null, endedOn: s.end?.day ?? null,
      reason: bounce?.reason ?? null, chargePaise: n(bounce?.chargePaise), bankChargePaise: n(bounce?.bankChargePaise), conflict: s.conflict, at: r.at,
    });
  }
  return out;
}

/**
 * For the counter dashboard: open cheques dated within the next `days` days (or earlier), i.e. received ones to
 * deposit and issued ones to keep funds ready for, with totals.
 */
export function chequesDue(db: DriveDB, days = 3, today = todayISO()) {
  const limit = addDays(today, days);
  const rows = listCheques(db, { open: true }, today).filter((c) => c.chequeDate <= limit);
  const sum = (d: Direction) => rows.filter((c) => c.direction === d).reduce((a, c) => a + c.amountPaise, 0);
  return { count: rows.length, receivedPaise: sum("received"), issuedPaise: sum("issued"), rows };
}

/** Totals for the top of the screen: received not yet cleared, issued not yet cleared, due within 3 days. */
export function chequeTotals(db: DriveDB, today = todayISO()) {
  const open = listCheques(db, { open: true }, today);
  const sum = (d: Direction) => open.filter((c) => c.direction === d).reduce((a, c) => a + c.amountPaise, 0);
  return { inHandPaise: sum("received"), issuedPaise: sum("issued"), dueSoon: open.filter((c) => c.days <= 3).length };
}

