/**
 * MEDORO Distribution orders on the device (phase D2): placing an order, credit hold and release, approval with stock
 * reserved batch-wise FEFO (pick lines), picking, packing, and invoicing exactly what was picked. Same rules as the
 * server (src/domain/distribution/orders.ts, billing.ts), built on the same pure functions.
 *
 * Records are only ever added (see migration 16): the order and its lines as placed; each step as an event whose id is
 * the order id + the step, so a step taken on two devices while offline is kept once; reserved stock as pick lines with
 * ids fixed per order; what was picked as a pick event per line. Status comes from the events (statusOf). An order is
 * approved on one device; if two approve it offline, the first copy to sync is kept (same ids).
 */
import { z } from "zod";
import { DriveDB } from "./client";
import { CounterError } from "./pharmacy";
import { activeSchemes, chemist, creditFor, distSeries, distSettings, isInterState, postInvoice, reservedUnits, stockOf, type BatchRow, type Med, type PostLine } from "./dist";
import { deliveryOf } from "./dist-trade";
import { fiscalYear, todayISO } from "@/lib/dates";
import { invoiceTotals, rateFor } from "@/domain/distribution/rules/pricing";
import { bestScheme } from "@/domain/distribution/rules/schemes";
import { allocateFefoReserved, ShortStockError, splitPaidFree, type AllocBatch } from "@/domain/distribution/rules/allocation";
import { assertMove, ORDER_STATUS, type OrderStatus } from "@/domain/distribution/rules/orderflow";

export { ORDER_STATUS };
const n = (v: unknown) => Number(v ?? 0);
const now = () => new Date().toISOString();
const pad = (x: number) => String(x).padStart(5, "0");
const inList = (ids: string[]) => `(${ids.map(() => "?").join(", ")})`;

type OrderRow = { id: string; branchId: string; no: string; customerId: string; estimatePaise: number; at: string; source: string; salesmanId: string | null; note: string | null };
type LineRow = { id: string; orderId: string; medicineId: string; qty: number; freeQty: number; ratePaise: number; discPct: number; schemeId: string | null };
type EventRow = { id: string; orderId: string; kind: string; reason: string | null; overrideReason: string | null; boxes: number | null; invoiceId: string | null; userId: string; at: string };
type PickRow = { id: string; orderId: string; orderLineId: string; medicineId: string; batchId: string; units: number; paidUnits: number };

// ---------- status ----------

/**
 * An order's status from its steps. An invoice that stands beats a cancellation made elsewhere offline (the goods
 * left with a bill); a cancelled invoice cancels the order.
 */
export function statusOf(db: DriveDB, orderId: string, events?: EventRow[]): OrderStatus {
  const ev = events ?? db.engine.all<EventRow>("SELECT * FROM distOrderEvent WHERE orderId = ?", [orderId]);
  const has = (k: string) => ev.some((e) => e.kind === k);
  const inv = ev.find((e) => e.kind === "invoiced");
  if (inv && !db.engine.all("SELECT 1 FROM distInvoiceCancel WHERE invoiceId = ?", [inv.invoiceId ?? ""]).length) {
    // After the invoice, the order follows its delivery: out on a van, then delivered (a failed drop is invoiced again).
    const d = deliveryOf(db, inv.invoiceId ?? "");
    return d.status === "delivered" ? "delivered" : d.status === "out" ? "dispatched" : "invoiced";
  }
  if (has("cancelled") || inv) return "cancelled";
  if (has("rejected")) return "rejected";
  if (has("packed")) return "packed";
  if (has("picking") || db.engine.all("SELECT 1 FROM distPickEvent WHERE orderId = ? LIMIT 1", [orderId]).length) return "picking";
  if (has("approved")) return "approved";
  return "pending";
}

function load(db: DriveDB, orderId: string) {
  const o = db.engine.all<OrderRow>("SELECT * FROM distOrder WHERE id = ?", [orderId])[0];
  if (!o) throw new CounterError("Order not found.");
  const lines = db.engine.all<LineRow>("SELECT * FROM distOrderLine WHERE orderId = ? ORDER BY rowid", [orderId]);
  return { ...o, lines, status: statusOf(db, orderId) };
}
const event = (db: DriveDB, orderId: string, kind: string, userId: string, more: Partial<EventRow> = {}) =>
  db.from("distOrderEvent").insert({ id: `${orderId}-${kind}`, orderId, kind, reason: null, overrideReason: null, boxes: null, invoiceId: null, userId, at: now(), ...more });
const move = (from: OrderStatus, to: OrderStatus) => { try { assertMove(from, to); } catch (e) { throw new CounterError((e as Error).message); } };

// ---------- quote and place ----------

type Chem = ReturnType<typeof chemist>;
function quote(db: DriveDB, branchId: string, chem: Chem, lines: { medicineId: string; qty: number }[], today: string) {
  const ids = [...new Set(lines.map((l) => l.medicineId))];
  const meds = new Map(db.engine.all<Med & { active: number }>(`SELECT id, name, gstRate, packSize, active FROM medicine WHERE id IN ${inList(ids)}`, ids).map((m) => [m.id, m]));
  const terms = new Map(db.engine.all<{ id: string; companyId: string | null; ptrPaise: number; ptsPaise: number; minOrderQty: number; discontinued: number }>(
    `SELECT id, companyId, ptrPaise, ptsPaise, minOrderQty, discontinued FROM distProduct WHERE deletedAt IS NULL AND id IN ${inList(ids)}`, ids).map((d) => [d.id, d]));
  const specials = new Map(db.engine.all<{ medicineId: string; ratePaise: number; validTo: string | null }>(
    `SELECT medicineId, ratePaise, validTo FROM distSpecialRate WHERE deletedAt IS NULL AND customerId = ? AND medicineId IN ${inList(ids)}`, [chem.id, ...ids]).map((s) => [s.medicineId, s]));
  const schemes = activeSchemes(db, today);
  void branchId;
  return lines.map((l) => {
    const m = meds.get(l.medicineId), d = terms.get(l.medicineId), name = m?.name ?? "Unknown product";
    if (!m || !d) throw new CounterError(`${name}: not set up for wholesale (no PTR).`);
    if (n(d.discontinued) || !n(m.active)) throw new CounterError(`${name}: discontinued.`);
    if (l.qty < n(d.minOrderQty)) throw new CounterError(`${name}: minimum order is ${d.minOrderQty}.`);
    const sp = specials.get(l.medicineId);
    const rate = rateFor({ ptr: n(d.ptrPaise), pts: n(d.ptsPaise) }, chem.priceTier, sp ? { rate: n(sp.ratePaise), validTo: sp.validTo } : null, today);
    const sch = bestScheme(schemes, { medicineId: m.id, companyId: d.companyId, qty: l.qty, customerId: chem.id }, today);
    return { medicineId: m.id, name, qty: l.qty, freeQty: sch.freeQty, rate, discPct: sch.discPct, schemeId: sch.schemeId, gstRate: n(m.gstRate) };
  });
}

export const orderInput = z.object({
  branchId: z.string().min(1), customerId: z.string().min(1, "Choose the chemist."), userId: z.string().min(1),
  source: z.enum(["salesman", "phone", "office"]).default("office"),
  /** The salesman booking it (only for their own chemists, unless the user may approve orders). */
  salesmanId: z.string().nullable().default(null), canApprove: z.boolean().default(true),
  note: z.string().trim().max(300).default(""),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, "Missing order key; start a new order."),
  lines: z.array(z.object({ medicineId: z.string().min(1), qty: z.number().int().min(1, "Quantity must be at least 1.").max(100000) })).min(1, "Add at least one product.").max(300, "Up to 300 products per order."),
});

/** Books an order. A credit problem doesn't refuse it: it waits for approval (a hard stop does refuse it). */
export function placeOrder(db: DriveDB, raw: z.input<typeof orderInput>, today = todayISO()) {
  const i = orderInput.parse(raw);
  const seen = db.engine.all<{ id: string; no: string; creditOk: number; creditReasons: string }>("SELECT id, no, creditOk, creditReasons FROM distOrder WHERE idempotencyKey = ?", [i.idempotencyKey])[0];
  if (seen) return { orderId: seen.id, no: seen.no, status: statusOf(db, seen.id), replayed: true, creditOk: !!n(seen.creditOk), reasons: JSON.parse(seen.creditReasons) as string[] };
  if (new Set(i.lines.map((l) => l.medicineId)).size !== i.lines.length) throw new CounterError("A product appears twice. Combine the lines.");
  return db.transaction(() => {
    const chem = chemist(db, i.customerId);
    if (i.salesmanId && !i.canApprove && chem.salesmanId !== i.salesmanId) throw new CounterError("This chemist isn’t assigned to you.");
    const lines = quote(db, i.branchId, chem, i.lines, today);
    const est = invoiceTotals(lines.map((l) => ({ qty: l.qty, rate: l.rate, gstRate: l.gstRate, discPct: l.discPct })), isInterState(distSettings(db).stateCode, chem)).total;
    const credit = creditFor(db, chem.id, est, today);
    if (credit.hard) throw new CounterError(`Order can’t be accepted: ${credit.reasons.join(" ")}`);
    const fy = fiscalYear(today);
    const no = `SO-${distSeries(db)}${fy}-${pad(db.nextSeq(`DSO:${fy}`))}`;
    const o = db.from<{ id: string }>("distOrder").insert({
      branchId: i.branchId, deviceId: db.device, no, customerId: chem.id, source: i.source, salesmanId: i.salesmanId ?? chem.salesmanId, placedByType: "user", placedById: i.userId,
      note: i.note || null, estimatePaise: est, creditOk: credit.ok ? 1 : 0, creditReasons: JSON.stringify(credit.reasons), idempotencyKey: i.idempotencyKey, at: now(),
    })[0];
    db.from("distOrderLine").insert(lines.map((l) => ({ orderId: o.id, medicineId: l.medicineId, qty: l.qty, freeQty: l.freeQty, ratePaise: l.rate, discPct: l.discPct, schemeId: l.schemeId })));
    return { orderId: o.id, no, status: "pending" as OrderStatus, replayed: false, creditOk: credit.ok, reasons: credit.reasons };
  });
}

// ---------- approve, reject, cancel ----------

export const approveInput = z.object({
  orderId: z.string().min(1), userId: z.string().min(1),
  /** The user may release credit holds (Manager / Owner). */
  canOverride: z.boolean().default(false), overrideReason: z.string().trim().max(200).default(""),
  /** Cut lines short to what is in stock instead of refusing. */
  allowPartial: z.boolean().default(false),
});

/**
 * Approves an order: credit is checked again (a hold needs a manager and a reason), then stock is reserved FEFO in whole
 * packs from batches with enough shelf life. Short lines are refused, or cut to what's there with allowPartial (free
 * goods kept in proportion).
 */
export function approveOrder(db: DriveDB, raw: z.input<typeof approveInput>, today = todayISO()) {
  const i = approveInput.parse(raw);
  return db.transaction(() => {
    const o = load(db, i.orderId);
    move(o.status, "approved");
    const credit = creditFor(db, o.customerId, n(o.estimatePaise), today, o.id);
    if (credit.hard) throw new CounterError(`Can’t approve: ${credit.reasons.join(" ")}`);
    const settings = distSettings(db);
    if (!credit.ok) {
      if (!i.canOverride) throw new CounterError(`Credit hold: ${credit.reasons.join(" ")} Ask a manager with credit override to approve it.`);
      if (i.overrideReason.length < 5) throw new CounterError(`Credit hold: ${credit.reasons.join(" ")} Enter a reason to override.`);
      if (settings.creditMode === "block") throw new CounterError(`Credit rules block this order: ${credit.reasons.join(" ")}`);
    }
    const ids = [...new Set(o.lines.map((l) => l.medicineId))];
    const meds = new Map(db.engine.all<Med>(`SELECT id, name, gstRate, packSize FROM medicine WHERE id IN ${inList(ids)}`, ids).map((m) => [m.id, m]));
    const batches = db.engine.all<BatchRow>(`SELECT id, branchId, medicineId, batchNo, expiryDate, costPaise, mrpPaise, status FROM batch WHERE deletedAt IS NULL AND medicineId IN ${inList(ids)}`, ids).filter((b) => b.branchId === o.branchId);
    const stock = stockOf(db, batches.map((b) => b.id));
    const alloc: AllocBatch[] = batches.map((b) => ({ id: b.id, medicineId: b.medicineId, batchNo: b.batchNo, expiry: b.expiryDate, qtyAvailable: stock.get(b.id) ?? 0, status: b.status }));
    const reserved = reservedUnits(db, o.id);
    const picks: Omit<PickRow, "id">[] = [], cut: string[] = [];
    for (const l of o.lines) {
      const m = meds.get(l.medicineId)!, pack = Math.max(1, n(m.packSize));
      let paid = n(l.qty), free = n(l.freeQty), allocs;
      try {
        allocs = allocateFefoReserved(alloc, l.medicineId, (paid + free) * pack, { reserved, today, minShelfDays: settings.minShelfDays, packSize: pack });
      } catch (e) {
        if (!(e instanceof ShortStockError)) throw e;
        if (!i.allowPartial) throw new CounterError(`${m.name}: only ${e.available} available, ordered ${paid + free}. Approve with “cut short lines” or wait for stock.`);
        const can = e.available;
        cut.push(`${m.name} ${can}/${paid + free}`);
        if (can <= 0) continue;
        const ratio = paid ? free / (paid + free) : 0;
        free = Math.floor(can * ratio); paid = can - free;
        allocs = allocateFefoReserved(alloc, l.medicineId, can * pack, { reserved, today, minShelfDays: settings.minShelfDays, packSize: pack });
      }
      for (const a of splitPaidFree(allocs, paid * pack)) {
        reserved[a.batchId] = (reserved[a.batchId] ?? 0) + a.units;
        picks.push({ orderId: o.id, orderLineId: l.id, medicineId: l.medicineId, batchId: a.batchId, units: a.units, paidUnits: a.paidUnits });
      }
    }
    if (!picks.length) throw new CounterError("Nothing on this order is in stock.");
    db.from("distPickLine").insert(picks.map((p, k) => ({ id: `${o.id}-pick-${k + 1}`, ...p })));
    event(db, o.id, "approved", i.userId, { overrideReason: credit.ok ? null : i.overrideReason, reason: cut.length ? `Cut: ${cut.join(", ")}` : null });
    return { cut, pickLines: picks.length };
  });
}

export function rejectOrder(db: DriveDB, input: { orderId: string; reason: string; userId: string }) {
  if (input.reason.trim().length < 3) throw new CounterError("Give a reason for the chemist.");
  return db.transaction(() => {
    const o = load(db, input.orderId);
    move(o.status, "rejected");
    event(db, o.id, "rejected", input.userId, { reason: input.reason.trim() });
  });
}

/** Cancels an order before it is invoiced; its reserved stock is free again. */
export function cancelOrder(db: DriveDB, input: { orderId: string; reason: string; userId: string }) {
  return db.transaction(() => {
    const o = load(db, input.orderId);
    move(o.status, "cancelled");
    event(db, o.id, "cancelled", input.userId, { reason: input.reason.trim() || null });
  });
}

// ---------- warehouse ----------

export function startPicking(db: DriveDB, input: { orderId: string; userId: string }) {
  return db.transaction(() => {
    const o = load(db, input.orderId);
    if (o.status !== "approved") throw new CounterError(o.status === "picking" ? "Picking has already started." : `This order is ${ORDER_STATUS[o.status].toLowerCase()}.`);
    event(db, o.id, "picking", input.userId);
  });
}

/** What was actually taken from the rack for a pick line (a short pick leaves the rest in stock). */
export function confirmPickLine(db: DriveDB, input: { pickLineId: string; pickedUnits: number; userId: string }) {
  if (!Number.isInteger(input.pickedUnits) || input.pickedUnits < 0) throw new CounterError("Enter the quantity picked.");
  return db.transaction(() => {
    const line = db.engine.all<PickRow>("SELECT * FROM distPickLine WHERE id = ?", [input.pickLineId])[0];
    if (!line) throw new CounterError("Pick line not found.");
    const st = statusOf(db, line.orderId);
    if (st !== "approved" && st !== "picking") throw new CounterError("This pick list is closed.");
    if (input.pickedUnits > n(line.units)) throw new CounterError(`Only ${line.units} were reserved from this batch.`);
    if (db.engine.all("SELECT 1 FROM distPickEvent WHERE pickLineId = ?", [line.id]).length) throw new CounterError("This line is already picked.");
    db.from("distPickEvent").insert({ id: `${line.id}-picked`, pickLineId: line.id, orderId: line.orderId, pickedUnits: input.pickedUnits, userId: input.userId, at: now() });
  });
}

export function packOrder(db: DriveDB, input: { orderId: string; boxes: number; userId: string }) {
  if (!Number.isInteger(input.boxes) || input.boxes < 1 || input.boxes > 999) throw new CounterError("Enter the number of boxes.");
  return db.transaction(() => {
    const o = load(db, input.orderId);
    if (o.status !== "picking" && o.status !== "approved") throw new CounterError(o.status === "packed" ? "This order is already packed." : `This order is ${ORDER_STATUS[o.status].toLowerCase()}.`);
    const lines = pickList(db, o.id);
    const open = lines.filter((l) => l.pickedUnits == null);
    if (open.length) throw new CounterError(`${open.length} line(s) not picked yet.`);
    if (!lines.some((l) => (l.pickedUnits ?? 0) > 0)) throw new CounterError("Nothing was picked. Cancel the order instead.");
    event(db, o.id, "packed", input.userId, { boxes: input.boxes });
  });
}

/** The order's pick lines with rack order data and what was picked. */
export function pickList(db: DriveDB, orderId: string) {
  return db.engine.all<PickRow & { batchNo: string; expiryDate: string; rack: string | null; name: string; pickedUnits: number | null }>(
    `SELECT p.*, b.batchNo, b.expiryDate, m.rack, m.name, e.pickedUnits FROM distPickLine p JOIN batch b ON b.id = p.batchId JOIN medicine m ON m.id = p.medicineId
       LEFT JOIN distPickEvent e ON e.pickLineId = p.id WHERE p.orderId = ? ORDER BY m.rack, m.name, b.expiryDate`, [orderId])
    .map((r) => ({ ...r, units: n(r.units), paidUnits: n(r.paidUnits), pickedUnits: r.pickedUnits == null ? null : n(r.pickedUnits) }));
}

// ---------- invoice an order ----------

/** Invoices a packed order from exactly what was picked (a short pick comes off free goods first). */
export function invoiceOrder(db: DriveDB, input: { orderId: string; userId: string }, today = todayISO()) {
  return db.transaction(() => {
    const o = load(db, input.orderId);
    move(o.status, "invoiced");
    if (o.status !== "packed") throw new CounterError("Pack the order before invoicing.");
    const chem = chemist(db, o.customerId);
    const picks = pickList(db, o.id);
    const ids = [...new Set(picks.map((p) => p.medicineId))];
    const meds = new Map(db.engine.all<Med>(`SELECT id, name, gstRate, packSize FROM medicine WHERE id IN ${inList(ids)}`, ids).map((m) => [m.id, m]));
    const lines: PostLine[] = [];
    for (const p of picks) {
      const picked = p.pickedUnits ?? 0;
      if (picked <= 0) continue;
      const ol = o.lines.find((x) => x.id === p.orderLineId)!, pack = Math.max(1, n(meds.get(p.medicineId)!.packSize));
      const paid = Math.min(p.paidUnits, picked);
      lines.push({ medicineId: p.medicineId, batchId: p.batchId, units: Math.floor(picked / pack) * pack, paidUnits: Math.floor(paid / pack) * pack, rate: n(ol.ratePaise), discPct: n(ol.discPct), schemeId: ol.schemeId });
    }
    const usable = lines.filter((l) => l.units > 0);
    if (!usable.length) throw new CounterError("Nothing was picked.");
    const batchIds = [...new Set(usable.map((l) => l.batchId))];
    const batches = db.engine.all<BatchRow>(`SELECT id, branchId, medicineId, batchNo, expiryDate, costPaise, mrpPaise, status FROM batch WHERE id IN ${inList(batchIds)}`, batchIds);
    const r = postInvoice(db, { orderId: o.id, branchId: o.branchId, chem, inter: isInterState(distSettings(db).stateCode, chem), lines: usable, meds, batches, stock: stockOf(db, batchIds),
      userId: input.userId, idempotencyKey: `order-${o.id}`, today, note: null });
    event(db, o.id, "invoiced", input.userId, { invoiceId: r.invoiceId });
    return r;
  });
}

// ---------- lists ----------

/** Orders with their status, newest first (open ones only with `open`). */
export function listOrders(db: DriveDB, opts: { open?: boolean; customerId?: string; limit?: number } = {}) {
  const rows = db.engine.all<OrderRow & { chemist: string }>(
    `SELECT o.*, c.name AS chemist FROM distOrder o JOIN customer c ON c.id = o.customerId ${opts.customerId ? "WHERE o.customerId = ?" : ""} ORDER BY o.at DESC LIMIT ?`,
    [...(opts.customerId ? [opts.customerId] : []), Math.min(opts.limit ?? 300, 2000)]);
  const events = new Map<string, EventRow[]>();
  if (rows.length) for (const e of db.engine.all<EventRow>(`SELECT * FROM distOrderEvent WHERE orderId IN ${inList(rows.map((r) => r.id))}`, rows.map((r) => r.id))) events.set(e.orderId, [...(events.get(e.orderId) ?? []), e]);
  return rows.map((r) => ({ ...r, estimatePaise: n(r.estimatePaise), status: statusOf(db, r.id, events.get(r.id) ?? []) }))
    .filter((r) => !opts.open || ["pending", "approved", "picking", "packed"].includes(r.status));
}
