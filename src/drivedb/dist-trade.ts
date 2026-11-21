/**
 * MEDORO Distribution on the device, phase D3: credit notes, expiry claims on companies, van trips and proof of
 * delivery, collections, receivables and statements. Same rules as the server (src/domain/distribution/returns.ts,
 * dispatch.ts, receivables.ts) and the same pure functions.
 *
 * Kept as added records only (migration 17). Expired or damaged goods a chemist returns don't go back into stock: they
 * wait in the batch's "returned" pool until claimed on the company (distClaimSource says how much of a claim came from
 * that pool). An invoice's delivery is a series of steps with fixed ids (planned on a trip, out, delivered or failed),
 * so a step taken on two devices offline is kept once; its state comes from the steps.
 */
import { z } from "zod";
import { DriveDB } from "./client";
import { CounterError } from "./pharmacy";
import { customerBalance, receivePayment } from "./trade";
import { recordCheque } from "./cheques";
import { distSeries } from "./dist";
import { addDays, daysTo, fiscalYear, istMidnight, todayISO } from "@/lib/dates";
import { gstDocNo } from "@/lib/docno";
import { shareOfLine } from "@/domain/distribution/rules/pricing";
import { claimEligibility, DEFAULT_POLICY, expectedCredit, expiryBand, type ClaimPolicy } from "@/domain/distribution/rules/expiry";
import { ageing, openBills } from "@/domain/distribution/rules/ageing";
import { creditRisk } from "@/domain/distribution/rules/analytics";

const n = (v: unknown) => Number(v ?? 0);
const now = () => new Date().toISOString();
const pad = (x: number) => String(x).padStart(5, "0");
const inList = (ids: string[]) => `(${ids.map(() => "?").join(", ")})`;
export const RETURN_CONDITIONS = { saleable: "Saleable (back to stock)", expired: "Expired (to claims)", damaged: "Damaged / breakage (to claims)" } as const;

// ---------- credit notes ----------

export const returnInput = z.object({
  invoiceId: z.string().min(1), userId: z.string().min(1),
  reason: z.string().trim().min(3, "Enter the reason for the return.").max(200),
  lines: z.array(z.object({
    invoiceLineId: z.string().min(1), qty: z.number().int().min(1, "Enter the quantity returned."),
    condition: z.enum(["saleable", "expired", "damaged"]), creditPct: z.number().min(0).max(100).default(100),
  })).min(1, "Choose what is coming back."),
});

/**
 * A credit note against a wholesale invoice. Saleable goods go back to their batch (if it hasn't expired); expired or
 * damaged goods wait to be claimed on the company. Credit is the line's value per pack (paid and free packs share it)
 * × the credit % agreed with the chemist; GST comes down in proportion.
 */
export function createReturn(db: DriveDB, raw: z.input<typeof returnInput>, today = todayISO()) {
  const i = returnInput.parse(raw);
  return db.transaction(() => {
    const inv = db.engine.all<{ id: string; no: string; branchId: string; customerId: string }>("SELECT id, no, branchId, customerId FROM distInvoice WHERE id = ?", [i.invoiceId])[0];
    if (!inv) throw new CounterError("Invoice not found.");
    if (db.engine.all("SELECT 1 FROM distInvoiceCancel WHERE invoiceId = ?", [inv.id]).length) throw new CounterError("This invoice was cancelled.");
    const invLines = new Map(db.engine.all<{ id: string; medicineId: string; batchId: string; qty: number; freeQty: number; taxablePaise: number; taxPaise: number; name: string; packSize: number; expiryDate: string }>(
      `SELECT l.id, l.medicineId, l.batchId, l.qty, l.freeQty, l.taxablePaise, l.taxPaise, m.name, m.packSize, b.expiryDate
         FROM distInvoiceLine l JOIN medicine m ON m.id = l.medicineId JOIN batch b ON b.id = l.batchId WHERE l.invoiceId = ?`, [inv.id]).map((l) => [l.id, l]));
    const seen = new Set<string>();
    const lines = i.lines.map((r) => {
      const l = invLines.get(r.invoiceLineId);
      if (!l) throw new CounterError("That line isn’t on this invoice.");
      if (seen.has(l.id)) throw new CounterError("A line appears twice."); seen.add(l.id);
      const billed = n(l.qty) + n(l.freeQty);
      const back = n(db.engine.all<{ v: number }>("SELECT COALESCE(SUM(qty), 0) AS v FROM distReturnLine WHERE invoiceLineId = ?", [l.id])[0].v);
      if (r.qty > billed - back) throw new CounterError(`${l.name}: ${billed - back} can still be returned (billed ${billed}, returned ${back}).`);
      const sh = shareOfLine(n(l.taxablePaise), n(l.taxPaise), r.qty, billed);
      return { r, l, taxable: Math.round((sh.taxable * r.creditPct) / 100), tax: Math.round((sh.tax * r.creditPct) / 100) };
    });
    const taxable = lines.reduce((a, x) => a + x.taxable, 0), tax = lines.reduce((a, x) => a + x.tax, 0), total = taxable + tax;
    if (total <= 0 && lines.every((x) => x.r.condition === "saleable")) throw new CounterError("Nothing to credit.");
    const fy = fiscalYear(today);
    const no = gstDocNo("C" + distSeries(db).slice(1), fy, db.nextSeq(`DCN:${fy}`), 5);
    const at = now();
    const ret = db.from<{ id: string }>("distReturn").insert({ branchId: inv.branchId, deviceId: db.device, no, invoiceId: inv.id, customerId: inv.customerId, reason: i.reason, taxablePaise: taxable, taxPaise: tax, totalPaise: total, userId: i.userId, at })[0];
    db.from("distReturnLine").insert(lines.map((x) => ({ returnId: ret.id, invoiceLineId: x.l.id, batchId: x.l.batchId, qty: x.r.qty, condition: x.r.condition, creditPct: x.r.creditPct, taxablePaise: x.taxable, taxPaise: x.tax })));
    for (const x of lines) {
      // Saleable goods of a batch that hasn't expired go back on the shelf; everything else waits to be claimed.
      if (x.r.condition === "saleable" && daysTo(x.l.expiryDate, today) > 0)
        db.from("stockMovement").insert({ branchId: inv.branchId, batchId: x.l.batchId, qty: x.r.qty * Math.max(1, n(x.l.packSize)), type: "return", refType: "dist_return", refId: ret.id, userId: i.userId, at, note: `${no} · ${RETURN_CONDITIONS.saleable}` });
    }
    return { returnId: ret.id, no, total };
  });
}

/** Units of a batch returned by chemists as expired / damaged (or saleable but already expired) and not yet claimed. */
export function returnedPool(db: DriveDB, batchId: string) {
  const back = n(db.engine.all<{ v: number }>(
    `SELECT COALESCE(SUM(rl.qty * MAX(1, m.packSize)), 0) AS v FROM distReturnLine rl JOIN batch b ON b.id = rl.batchId JOIN medicine m ON m.id = b.medicineId
      WHERE rl.batchId = ? AND NOT EXISTS (SELECT 1 FROM stockMovement s WHERE s.refType = 'dist_return' AND s.refId = rl.returnId AND s.batchId = rl.batchId AND rl.condition = 'saleable')`, [batchId])[0].v);
  const claimed = n(db.engine.all<{ v: number }>("SELECT COALESCE(SUM(fromReturnsUnits), 0) AS v FROM distClaimSource WHERE batchId = ?", [batchId])[0].v);
  return Math.max(0, back - claimed);
}

export function listReturns(db: DriveDB, limit = 200) {
  return db.engine.all<{ id: string; no: string; at: string; customer: string; invoiceNo: string; totalPaise: number; reason: string; packs: number; toClaims: number }>(
    `SELECT r.id, r.no, r.at, c.name AS customer, i.no AS invoiceNo, r.totalPaise, r.reason,
            (SELECT COALESCE(SUM(qty), 0) FROM distReturnLine WHERE returnId = r.id) AS packs,
            (SELECT COALESCE(SUM(qty), 0) FROM distReturnLine WHERE returnId = r.id AND condition <> 'saleable') AS toClaims
       FROM distReturn r JOIN customer c ON c.id = r.customerId JOIN distInvoice i ON i.id = r.invoiceId ORDER BY r.at DESC LIMIT ?`, [limit])
    .map((r) => ({ ...r, totalPaise: n(r.totalPaise), packs: n(r.packs), toClaims: n(r.toClaims) }));
}

// ---------- principals and expiry claims ----------

export const principalInput = z.object({
  companyId: z.string().min(1), supplierId: z.string().nullable().default(null), marginPct: z.number().min(0).max(100).default(10),
  claimBeforeDays: z.number().int().min(0).max(730).default(90), claimAfterDays: z.number().int().min(0).max(730).default(180),
  claimCreditPct: z.number().min(0).max(100).default(100),
});
/** A company's stockist terms: the supplier claims are raised on, the claim window and the credit given. One per company. */
export function savePrincipal(db: DriveDB, raw: z.input<typeof principalInput>) {
  const p = principalInput.parse(raw);
  if (!db.from("distCompany").eq("id", p.companyId).count()) throw new CounterError("Company not found.");
  if (p.supplierId && !db.from("supplier").eq("id", p.supplierId).count()) throw new CounterError("Supplier not found.");
  const cur = db.engine.all<{ id: string }>("SELECT id FROM distPrincipal WHERE deletedAt IS NULL AND companyId = ?", [p.companyId])[0];
  if (cur) { db.from("distPrincipal").eq("id", cur.id).update(p); return cur.id; }
  return db.from<{ id: string }>("distPrincipal").insert({ ...p, active: 1 })[0].id;
}

function policyOf(db: DriveDB, medicineId: string): { policy: ClaimPolicy; supplierId: string | null } {
  const p = db.engine.all<{ supplierId: string | null; claimBeforeDays: number; claimAfterDays: number; claimCreditPct: number }>(
    `SELECT p.supplierId, p.claimBeforeDays, p.claimAfterDays, p.claimCreditPct FROM distProduct d JOIN distPrincipal p ON p.companyId = d.companyId AND p.deletedAt IS NULL AND p.active = 1
      WHERE d.id = ? AND d.deletedAt IS NULL`, [medicineId])[0];
  return p ? { policy: { claimBeforeDays: n(p.claimBeforeDays), claimAfterDays: n(p.claimAfterDays), claimCreditPct: n(p.claimCreditPct) }, supplierId: p.supplierId } : { policy: DEFAULT_POLICY, supplierId: null };
}

const shelf = (db: DriveDB, batchId: string) => n(db.engine.all<{ q: number }>("SELECT COALESCE(SUM(qty), 0) AS q FROM stockMovement WHERE batchId = ?", [batchId])[0].q);

/** Every batch in a godown with stock (shelf or returned) expiring within `days`: band, whether the company takes it back now, expected credit. */
export function expiryWorkbench(db: DriveDB, branchId: string, days = 180, today = todayISO()) {
  const rows = db.engine.all<{ id: string; medicineId: string; name: string; packSize: number; batchNo: string; expiryDate: string; costPaise: number; supplierId: string | null }>(
    `SELECT b.id, b.medicineId, m.name, m.packSize, b.batchNo, b.expiryDate, b.costPaise, b.supplierId FROM batch b JOIN medicine m ON m.id = b.medicineId
      WHERE b.branchId = ? AND b.deletedAt IS NULL AND b.expiryDate <= ? ORDER BY b.expiryDate`, [branchId, addDays(today, days)]);
  return rows.map((b) => {
    const onShelf = shelf(db, b.id), returned = returnedPool(db, b.id), pack = Math.max(1, n(b.packSize));
    if (onShelf + returned <= 0) return null;
    const left = daysTo(b.expiryDate, today), p = policyOf(db, b.medicineId), el = claimEligibility(left, p.policy);
    const value = Math.round(((onShelf + returned) / pack) * n(b.costPaise)), supplierId = b.supplierId ?? p.supplierId;
    return { batchId: b.id, medicine: b.name, batchNo: b.batchNo, expiry: b.expiryDate, daysLeft: left, band: expiryBand(left), onShelf: onShelf / pack, returned: returned / pack, value,
      supplierId, eligible: el.eligible && !!supplierId, why: supplierId ? el.reason : "No supplier on record for this batch.", expectedCredit: expectedCredit(value, p.policy), creditPct: p.policy.claimCreditPct };
  }).filter((r) => r !== null);
}

export const distClaimInput = z.object({
  branchId: z.string().min(1), batchId: z.string().min(1), userId: z.string().min(1),
  qty: z.number().int().min(1, "Enter the packs to claim."), reason: z.enum(["expiry", "near_expiry", "breakage"]), note: z.string().trim().max(200).default(""),
});

/**
 * An expiry / breakage claim on the company: from goods chemists returned first, then from the shelf, within the
 * company's claim window. It is an ordinary supplier claim (acknowledgement, credit notes and write-off as for any claim).
 */
export function raiseDistClaim(db: DriveDB, raw: z.input<typeof distClaimInput>, today = todayISO()) {
  const i = distClaimInput.parse(raw);
  return db.transaction(() => {
    const b = db.engine.all<{ id: string; branchId: string; medicineId: string; batchNo: string; expiryDate: string; costPaise: number; supplierId: string | null; name: string; packSize: number; gstRate: number }>(
      "SELECT b.id, b.branchId, b.medicineId, b.batchNo, b.expiryDate, b.costPaise, b.supplierId, m.name, m.packSize, m.gstRate FROM batch b JOIN medicine m ON m.id = b.medicineId WHERE b.id = ?", [i.batchId])[0];
    if (!b) throw new CounterError("Batch not found.");
    if (b.branchId !== i.branchId) throw new CounterError("Claim stock from the godown that holds it.");
    const p = policyOf(db, b.medicineId), supplierId = b.supplierId ?? p.supplierId;
    if (!supplierId) throw new CounterError("This batch has no supplier on record. Link the company to its supplier under Principals.");
    if (i.reason !== "breakage") { const el = claimEligibility(daysTo(b.expiryDate, today), p.policy); if (!el.eligible) throw new CounterError(el.reason); }
    const pack = Math.max(1, n(b.packSize)), units = i.qty * pack, pool = returnedPool(db, b.id), onShelf = shelf(db, b.id);
    if (units > pool + onShelf) throw new CounterError(`Only ${(pool + onShelf) / pack} packs of this batch are here.`);
    const fromReturns = Math.min(units, pool), fromShelf = units - fromReturns;
    const taxable = i.qty * n(b.costPaise), tax = Math.round((taxable * n(b.gstRate)) / 100);
    const fy = fiscalYear(today), series = distSeries(db).slice(1);
    const claimNo = `CLM-${series}-${fy}-${String(db.nextSeq(`CLM:${series}:${fy}`)).padStart(4, "0")}`;
    const why = `${i.reason === "expiry" ? "Expired" : i.reason === "near_expiry" ? "Near expiry" : "Breakage"}${i.note ? " · " + i.note : ""}`, at = now();
    const c = db.from<{ id: string }>("supplierClaim").insert({ claimNo, branchId: b.branchId, supplierId, batchId: b.id, medicineId: b.medicineId, qty: units, reason: i.reason, note: i.note || null, claimPaise: taxable + tax, taxPaise: tax, userId: i.userId, at })[0];
    db.from("distClaimSource").insert({ id: `${c.id}-src`, claimId: c.id, batchId: b.id, fromReturnsUnits: fromReturns, at });
    if (fromShelf) db.from("stockMovement").insert({ branchId: b.branchId, batchId: b.id, qty: -fromShelf, type: "supplier_return", refType: "supplier_claim", refId: c.id, userId: i.userId, at, note: `${claimNo} · claim · ${why}` });
    return { claimId: c.id, claimNo, value: taxable + tax, expected: expectedCredit(taxable + tax, p.policy), fromReturns: fromReturns / pack };
  });
}

// ---------- dispatch and delivery ----------

type DelEvent = { id: string; invoiceId: string; dispatchId: string | null; kind: "planned" | "out" | "delivered" | "failed"; receiverName: string | null; note: string | null; collectedPaise: number; collectMode: string | null; receiptId: string | null; at: string };
export type DeliveryState = { status: "pending" | "planned" | "out" | "delivered"; dispatchId: string | null; receiverName: string | null; failReason: string | null; collectedPaise: number };

/** An invoice's delivery from its steps: delivered once delivered; else on its latest trip (planned / out) unless that trip failed it. */
export function deliveryOf(db: DriveDB, invoiceId: string, events?: DelEvent[]): DeliveryState {
  const ev = events ?? db.engine.all<DelEvent>("SELECT * FROM distDeliveryEvent WHERE invoiceId = ? ORDER BY at, rowid", [invoiceId]);
  const done = ev.find((e) => e.kind === "delivered");
  if (done) return { status: "delivered", dispatchId: done.dispatchId, receiverName: done.receiverName, failReason: null, collectedPaise: n(done.collectedPaise) };
  const plans = ev.filter((e) => e.kind === "planned");
  const last = plans[plans.length - 1];
  const failed = [...ev].reverse().find((e) => e.kind === "failed");
  if (!last || ev.some((e) => e.kind === "failed" && e.dispatchId === last.dispatchId)) return { status: "pending", dispatchId: null, receiverName: null, failReason: failed?.note ?? null, collectedPaise: 0 };
  return { status: ev.some((e) => e.kind === "out" && e.dispatchId === last.dispatchId) ? "out" : "planned", dispatchId: last.dispatchId, receiverName: null, failReason: null, collectedPaise: 0 };
}

export const dispatchInput = z.object({
  branchId: z.string().min(1), userId: z.string().min(1), vehicleNo: z.string().trim().toUpperCase().max(20).default(""), driverName: z.string().trim().max(60).default(""),
  deliveryUser: z.string().default(""), route: z.string().trim().max(80).default(""), invoiceIds: z.array(z.string().min(1)).min(1, "Choose the invoices going out."),
});
/** Plans a van trip with invoices of this godown that are waiting to go. */
export function createDispatch(db: DriveDB, raw: z.input<typeof dispatchInput>, today = todayISO()) {
  const i = dispatchInput.parse(raw);
  return db.transaction(() => {
    const invs = db.engine.all<{ id: string; branchId: string }>(`SELECT id, branchId FROM distInvoice WHERE id IN ${inList(i.invoiceIds)}`, i.invoiceIds);
    if (invs.length !== new Set(i.invoiceIds).size) throw new CounterError("An invoice was not found.");
    if (invs.some((x) => x.branchId !== i.branchId)) throw new CounterError("Dispatch invoices from the godown you are in.");
    if (db.engine.all(`SELECT 1 FROM distInvoiceCancel WHERE invoiceId IN ${inList(i.invoiceIds)}`, i.invoiceIds).length) throw new CounterError("A cancelled invoice can’t be dispatched.");
    if (invs.some((x) => deliveryOf(db, x.id).status !== "pending")) throw new CounterError("An invoice is already on another dispatch or delivered.");
    const fy = fiscalYear(today);
    const no = `DSP-${distSeries(db).slice(1)}${fy}-${pad(db.nextSeq(`DSP:${fy}`))}`;
    const d = db.from<{ id: string }>("distDispatch").insert({ branchId: i.branchId, deviceId: db.device, no, vehicleNo: i.vehicleNo || null, driverName: i.driverName || null, deliveryUser: i.deliveryUser || null, route: i.route || null, userId: i.userId, at: now() })[0];
    db.from("distDeliveryEvent").insert(invs.map((x) => ({ id: `${x.id}-${d.id}-planned`, invoiceId: x.id, dispatchId: d.id, kind: "planned", collectedPaise: 0, userId: i.userId, at: now() })));
    return { dispatchId: d.id, no };
  });
}

/** The van leaves: every invoice still on it is out for delivery. */
export function startDispatch(db: DriveDB, input: { dispatchId: string; userId: string }) {
  return db.transaction(() => {
    const st = dispatchState(db, input.dispatchId);
    if (st.status !== "planned") throw new CounterError("This dispatch already left.");
    const on = st.invoices.filter((x) => x.delivery.status === "planned");
    db.from("distDeliveryEvent").insert(on.map((x) => ({ id: `${x.invoiceId}-${input.dispatchId}-out`, invoiceId: x.invoiceId, dispatchId: input.dispatchId, kind: "out", collectedPaise: 0, userId: input.userId, at: now() })));
    return on.length;
  });
}

function dispatchState(db: DriveDB, dispatchId: string) {
  const d = db.engine.all<{ id: string; no: string }>("SELECT id, no FROM distDispatch WHERE id = ?", [dispatchId])[0];
  if (!d) throw new CounterError("Dispatch not found.");
  const ids = db.engine.all<{ invoiceId: string }>("SELECT DISTINCT invoiceId FROM distDeliveryEvent WHERE dispatchId = ? AND kind = 'planned'", [dispatchId]).map((r) => r.invoiceId);
  const invoices = ids.map((invoiceId) => ({ invoiceId, delivery: deliveryOf(db, invoiceId) }));
  const mine = invoices.filter((x) => x.delivery.dispatchId === dispatchId || x.delivery.status === "pending" || x.delivery.status === "delivered");
  const left = mine.some((x) => x.delivery.dispatchId === dispatchId && (x.delivery.status === "planned" || x.delivery.status === "out"));
  const out = db.engine.all("SELECT 1 FROM distDeliveryEvent WHERE dispatchId = ? AND kind = 'out' LIMIT 1", [dispatchId]).length > 0;
  return { ...d, invoices, status: !out ? "planned" as const : left ? "out" as const : "closed" as const };
}

export const deliverInput = z.object({
  invoiceId: z.string().min(1), userId: z.string().min(1), outcome: z.enum(["delivered", "failed"]),
  receiverName: z.string().trim().max(60).default(""), note: z.string().trim().max(200).default(""),
  collectedPaise: z.number().int().min(0, "Amount can’t be negative.").default(0), mode: z.enum(["cash", "upi", "cheque"]).default("cash"),
  chequeNo: z.string().trim().default(""), bank: z.string().trim().default(""), chequeDate: z.string().default(""),
});

/**
 * Proof of delivery. Delivered needs the receiver's name; money collected at the door is a receipt from the chemist
 * (cash, UPI, or a cheque tracked like any cheque). A failed delivery goes back to the dispatch desk.
 */
export function recordDelivery(db: DriveDB, raw: z.input<typeof deliverInput>, today = todayISO()) {
  const i = deliverInput.parse(raw);
  if (i.outcome === "delivered" && i.receiverName.length < 2) throw new CounterError("Enter who received the goods.");
  if (i.outcome === "failed" && i.note.length < 3) throw new CounterError("Enter why it couldn’t be delivered.");
  return db.transaction(() => {
    const inv = db.engine.all<{ id: string; no: string; customerId: string }>("SELECT id, no, customerId FROM distInvoice WHERE id = ?", [i.invoiceId])[0];
    if (!inv) throw new CounterError("Invoice not found.");
    const st = deliveryOf(db, inv.id);
    if (st.status === "delivered") throw new CounterError("Already delivered.");
    let receiptId: string | null = null;
    if (i.outcome === "delivered" && i.collectedPaise > 0) receiptId = collect(db, { customerId: inv.customerId, amountPaise: i.collectedPaise, mode: i.mode, ref: `${inv.no} delivery`, chequeNo: i.chequeNo, bank: i.bank, chequeDate: i.chequeDate, userId: i.userId, invoiceId: inv.id, salesmanId: null }, today);
    if (i.outcome === "delivered")
      db.from("distDeliveryEvent").insert({ id: `${inv.id}-delivered`, invoiceId: inv.id, dispatchId: st.dispatchId, kind: "delivered", receiverName: i.receiverName, note: i.note || null, collectedPaise: i.collectedPaise, collectMode: i.collectedPaise ? i.mode : null, receiptId, userId: i.userId, at: now() });
    else {
      if (!st.dispatchId) throw new CounterError("This invoice isn’t on a trip.");
      db.from("distDeliveryEvent").insert({ id: `${inv.id}-${st.dispatchId}-failed`, invoiceId: inv.id, dispatchId: st.dispatchId, kind: "failed", note: i.note, collectedPaise: 0, userId: i.userId, at: now() });
    }
    return { receiptId };
  });
}

/** Invoices waiting to go out, and recent trips with their deliveries. */
export function dispatchBoard(db: DriveDB, branchId: string) {
  const invs = db.engine.all<{ id: string; no: string; date: string; totalPaise: number; customer: string; address: string | null; phone: string | null }>(
    `SELECT i.id, i.no, i.date, i.totalPaise, c.name AS customer, c.address, c.phone FROM distInvoice i JOIN customer c ON c.id = i.customerId
      WHERE i.branchId = ? AND NOT EXISTS (SELECT 1 FROM distInvoiceCancel x WHERE x.invoiceId = i.id) ORDER BY i.at DESC LIMIT 1000`, [branchId]);
  const rows = invs.map((x) => ({ ...x, totalPaise: n(x.totalPaise), delivery: deliveryOf(db, x.id) }));
  const trips = db.engine.all<{ id: string }>("SELECT id FROM distDispatch WHERE branchId = ? ORDER BY at DESC LIMIT 50", [branchId]).map((t) => dispatchState(db, t.id));
  return { pending: rows.filter((r) => r.delivery.status === "pending"), trips: trips.map((t) => ({ ...t, deliveries: rows.filter((r) => t.invoices.some((x) => x.invoiceId === r.id)) })) };
}

// ---------- collections ----------

export const collectInput = z.object({
  customerId: z.string().min(1, "Choose the chemist."), userId: z.string().min(1), amountPaise: z.number().int().min(100, "Enter at least ₹1."),
  mode: z.enum(["cash", "upi", "card", "cheque"]), ref: z.string().trim().max(60).default(""),
  chequeNo: z.string().trim().default(""), bank: z.string().trim().default(""), chequeDate: z.string().default(""),
  /** The salesman collecting (only from their own chemists, unless the user may approve orders). */
  salesmanId: z.string().nullable().default(null), canApprove: z.boolean().default(true), invoiceId: z.string().nullable().default(null),
});

function collect(db: DriveDB, raw: z.input<typeof collectInput>, today: string) {
  const i = collectInput.parse(raw);
  const receiptId = i.mode === "cheque"
    ? db.engine.all<{ linkId: string }>("SELECT linkId FROM cheque WHERE id = ?", [recordCheque(db, { direction: "received", partyId: i.customerId, chequeNo: i.chequeNo, bank: i.bank, chequeDate: i.chequeDate || today, amountPaise: i.amountPaise, note: i.ref || undefined, userId: i.userId }, today).id])[0].linkId
    : receivePayment(db, { customerId: i.customerId, amountPaise: i.amountPaise, mode: i.mode, ref: i.ref || undefined, userId: i.userId }).id;
  db.from("distCollection").insert({ customerId: i.customerId, receiptId, amountPaise: i.amountPaise, mode: i.mode, ref: i.ref || null, salesmanId: i.salesmanId, invoiceId: i.invoiceId, userId: i.userId, at: now() });
  return receiptId;
}

/** A payment from a chemist, in the office or by a salesman in the field. Refuses more than the chemist owes. */
export function collectPayment(db: DriveDB, raw: z.input<typeof collectInput>, today = todayISO()) {
  const i = collectInput.parse(raw);
  return db.transaction(() => {
    const chem = db.engine.all<{ salesmanId: string | null }>("SELECT salesmanId FROM distChemist WHERE id = ? AND deletedAt IS NULL", [i.customerId])[0];
    if (!chem) throw new CounterError("Chemist not found.");
    if (i.salesmanId && !i.canApprove && chem.salesmanId !== i.salesmanId) throw new CounterError("This chemist isn’t assigned to you.");
    return { receiptId: collect(db, i, today), balancePaise: customerBalance(db, i.customerId) };
  });
}

export function collectionsOn(db: DriveDB, day = todayISO()) {
  const from = istMidnight(day).toISOString(), to = istMidnight(addDays(day, 1)).toISOString();
  return db.engine.all<{ id: string; customer: string; amountPaise: number; mode: string; ref: string | null; salesmanId: string | null; at: string }>(
    "SELECT k.id, c.name AS customer, k.amountPaise, k.mode, k.ref, k.salesmanId, k.at FROM distCollection k JOIN customer c ON c.id = k.customerId WHERE k.at >= ? AND k.at < ? ORDER BY k.at DESC", [from, to])
    .map((r) => ({ ...r, amountPaise: n(r.amountPaise) }));
}

// ---------- receivables ----------

/** Bill-wise outstanding, ageing and a credit-risk score for every chemist (FIFO against the balance), largest first. */
export function receivables(db: DriveDB, today = todayISO(), opts: { salesmanId?: string } = {}) {
  const since = addDays(today, -90), since90 = istMidnight(since).toISOString();
  const chems = db.engine.all<{ id: string; name: string; phone: string | null; creditLimitPaise: number; creditDays: number; status: string; salesmanId: string | null; territoryId: string | null }>(
    `SELECT c.id, c.name, c.phone, c.creditLimitPaise, d.creditDays, d.status, d.salesmanId, d.territoryId FROM distChemist d JOIN customer c ON c.id = d.id
      WHERE d.deletedAt IS NULL ${opts.salesmanId ? "AND d.salesmanId = ?" : ""}`, opts.salesmanId ? [opts.salesmanId] : []);
  return chems.map((ch) => {
    const balance = customerBalance(db, ch.id);
    const bills = db.engine.all<{ id: string; no: string; date: string; dueDate: string; total: number }>(
      `SELECT i.id, i.no, i.date, i.dueDate, i.totalPaise AS total FROM distInvoice i WHERE i.customerId = ? AND NOT EXISTS (SELECT 1 FROM distInvoiceCancel x WHERE x.invoiceId = i.id) ORDER BY i.date DESC`, [ch.id])
      .map((b) => ({ ...b, total: n(b.total) }));
    const open = openBills(bills, balance, today);
    const overdue = open.filter((b) => b.overdueDays > 0).reduce((a, b) => a + b.open, 0);
    const oldest = open.filter((b) => b.id !== "opening")[0];
    const bounces = n(db.engine.all<{ v: number }>("SELECT COUNT(*) AS v FROM chequeEvent e JOIN cheque q ON q.id = e.chequeId WHERE q.customerId = ? AND e.kind = 'bounced' AND e.day >= ?", [ch.id, since])[0].v);
    const paid90 = n(db.engine.all<{ v: number }>("SELECT COALESCE(SUM(amountPaise), 0) AS v FROM customerReceipt WHERE customerId = ? AND amountPaise > 0 AND at >= ?", [ch.id, since90])[0].v);
    const billed90 = n(db.engine.all<{ v: number }>("SELECT COALESCE(SUM(totalPaise), 0) AS v FROM distInvoice WHERE customerId = ? AND at >= ?", [ch.id, since90])[0].v);
    const risk = creditRisk({ limit: n(ch.creditLimitPaise), balance, overdue, oldestDays: oldest?.ageDays ?? 0, creditDays: n(ch.creditDays), bounces90d: bounces, paidLast90: paid90, billedLast90: billed90 });
    return { customerId: ch.id, name: ch.name, phone: ch.phone, limit: n(ch.creditLimitPaise), creditDays: n(ch.creditDays), status: ch.status, salesmanId: ch.salesmanId, territoryId: ch.territoryId,
      balance, overdue, oldestDays: oldest?.ageDays ?? 0, buckets: ageing(open), open, risk };
  }).sort((a, b) => b.balance - a.balance);
}

/** A chemist's statement: invoices, credit notes and payments with a running balance. */
export function chemistStatement(db: DriveDB, customerId: string, from?: string, to?: string) {
  const rows = db.engine.all<{ at: string; no: string; narration: string; amount: number }>(
    `SELECT i.at, i.no, 'Invoice' AS narration, i.totalPaise AS amount FROM distInvoice i WHERE i.customerId = ?1
     UNION ALL SELECT x.at, i.no, 'Cancelled: ' || x.reason, -i.totalPaise FROM distInvoiceCancel x JOIN distInvoice i ON i.id = x.invoiceId WHERE i.customerId = ?1
     UNION ALL SELECT r.at, r.no, 'Credit note · ' || r.reason, -r.totalPaise FROM distReturn r WHERE r.customerId = ?1
     UNION ALL SELECT p.at, COALESCE(p.ref, p.mode), 'Payment · ' || p.mode, -p.amountPaise FROM customerReceipt p WHERE p.customerId = ?1
     ORDER BY 1`, [customerId]);
  let run = 0, opening = 0;
  const out: { date: string; no: string; narration: string; dr: number; cr: number; balance: number }[] = [];
  for (const r of rows) {
    const d = r.at.slice(0, 10), amt = n(r.amount);
    run += amt;
    if (from && d < from) { opening += amt; continue; }
    if (to && d > to) continue;
    out.push({ date: d, no: r.no, narration: r.narration, dr: Math.max(0, amt), cr: Math.max(0, -amt), balance: run });
  }
  return { opening, rows: out, closing: run };
}
