/**
 * MEDORO Distribution on the device: a distributor's masters and wholesale invoices in its own database (and, encrypted,
 * its own Google Drive), so its records never sit on Medoro's server. Same rules as the server
 * (src/domain/distribution/billing.ts), built on the same pure functions (src/domain/distribution/rules):
 *   - rate: the chemist's special rate while valid, else PTR or PTS by the chemist's price tier;
 *   - the best trade scheme (free goods or extra discount);
 *   - FEFO batches in whole packs, skipping stock closer to expiry than the minimum shelf life;
 *   - credit control: a hold needs a manager (override) and a reason, a hard stop (blocked, no or expired drug
 *     licence) can't be overridden; "block" mode refuses holds too;
 *   - GST on the rate ex-GST, CGST + SGST in the state, IGST outside it, round-off to the rupee;
 *   - same-day cancellation only (later corrections are credit notes).
 * Godowns are branches. Invoice numbers are per device (W + device series), so counters never clash offline.
 */
import { z } from "zod";
import { DriveDB } from "./client";
import { CounterError } from "./pharmacy";
import { customerBalance } from "./trade";
import { seriesFor } from "./seed";
import { addDays, fiscalYear, todayISO } from "@/lib/dates";
import { gstDocNo } from "@/lib/docno";
import { invoiceTotals, rateFor } from "@/domain/distribution/rules/pricing";
import { bestScheme, type Scheme } from "@/domain/distribution/rules/schemes";
import { allocateFefoReserved, ShortStockError, splitPaidFree, type AllocBatch } from "@/domain/distribution/rules/allocation";
import { creditCheck, type CreditDecision } from "@/domain/distribution/rules/credit";
import { openBills as ageOpenBills } from "@/domain/distribution/rules/ageing";
import { distSettingsOf, type DistSettings } from "@/domain/distribution/settings-shape";

const n = (v: unknown) => Number(v ?? 0);
const opt = (max: number) => z.string().trim().max(max).optional().transform((v) => v || null);
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a date like 2026-11-01.");

// ---------- settings ----------

/** The distributor's settings (minimum shelf life, credit mode…), and the GST state of the godowns. */
export function distSettings(db: DriveDB): DistSettings & { stateCode: string | null } {
  let raw: unknown = {};
  try { raw = JSON.parse(db.getMeta("dist") ?? "{}"); } catch { /* defaults */ }
  const s = distSettingsOf({ dist: raw });
  const pharmacy = (() => { try { return JSON.parse(db.getMeta("pharmacy") ?? "{}") as { gstin?: string }; } catch { return {}; } })();
  const own = (raw as { stateCode?: string }).stateCode ?? pharmacy.gstin?.slice(0, 2) ?? null;
  return { ...s, stateCode: own || null };
}
export function saveDistSettings(db: DriveDB, patch: Partial<DistSettings> & { stateCode?: string | null }) {
  let cur: Record<string, unknown> = {};
  try { cur = JSON.parse(db.getMeta("dist") ?? "{}"); } catch { /* start again */ }
  if (patch.minShelfDays !== undefined && (!Number.isInteger(patch.minShelfDays) || patch.minShelfDays < 0 || patch.minShelfDays > 730)) throw new CounterError("Minimum shelf life is 0 to 730 days.");
  if (patch.creditMode !== undefined && !["hold", "block"].includes(patch.creditMode)) throw new CounterError("Credit mode is hold or block.");
  if (patch.stateCode !== undefined && patch.stateCode !== null && !/^\d{2}$/.test(patch.stateCode)) throw new CounterError("State code is two digits (e.g. 27).");
  db.setMeta("dist", JSON.stringify({ ...cur, ...patch }));
  return distSettings(db);
}

/** This device's wholesale invoice series: W + the device's own series letters. */
export const distSeries = (db: DriveDB) => "W" + seriesFor(db.device).slice(1);

// ---------- masters ----------

export const companyInput = z.object({ name: z.string().trim().min(2, "Company name is required.").max(120), shortName: opt(20), gstin: opt(15), phone: opt(15) });
export function saveCompany(db: DriveDB, id: string | null, raw: z.input<typeof companyInput>) {
  const c = companyInput.parse(raw);
  const dup = db.engine.all<{ id: string }>("SELECT id FROM distCompany WHERE deletedAt IS NULL AND name = ? COLLATE NOCASE", [c.name])[0];
  if (dup && dup.id !== id) throw new CounterError(`${c.name} is already a company.`);
  if (id) { db.from("distCompany").eq("id", id).update(c); return id; }
  return db.from<{ id: string }>("distCompany").insert({ ...c, active: 1 })[0].id;
}

export const productInput = z.object({
  medicineId: z.string().min(1), companyId: z.string().nullable().default(null), division: opt(40),
  ptrPaise: z.number().int().min(1, "Enter the PTR."), ptsPaise: z.number().int().min(0).default(0),
  minOrderQty: z.number().int().min(1).default(1), portalVisible: z.boolean().default(true), discontinued: z.boolean().default(false),
});
/** The wholesale terms of a catalogue medicine (PTR / PTS, company). One row per medicine. */
export function saveProduct(db: DriveDB, raw: z.input<typeof productInput>) {
  const p = productInput.parse(raw);
  if (!db.from("medicine").eq("id", p.medicineId).count()) throw new CounterError("Medicine not found.");
  if (p.ptsPaise && p.ptsPaise > p.ptrPaise) throw new CounterError("PTS is the stockist rate: it can’t be above PTR.");
  const { medicineId, ...rest } = p;
  db.from("distProduct").upsert({ id: medicineId, ...rest, portalVisible: rest.portalVisible ? 1 : 0, discontinued: rest.discontinued ? 1 : 0 });
}

export const chemistInput = z.object({
  customerId: z.string().min(1), ownerName: opt(80), stateCode: z.string().regex(/^\d{2}$/, "State code is two digits.").nullable().default(null),
  dl20b: opt(40), dl21b: opt(40), dlExpiry: isoDate.nullable().default(null),
  creditDays: z.number().int().min(0).max(365).default(21), graceDays: z.number().int().min(0).max(180).default(7),
  territoryId: z.string().nullable().default(null), salesmanId: z.string().nullable().default(null),
  priceTier: z.enum(["ptr", "pts"]).default("ptr"),
});
/** The wholesale profile of a customer (licences, credit terms, price tier). */
export function saveChemist(db: DriveDB, raw: z.input<typeof chemistInput>) {
  const c = chemistInput.parse(raw);
  if (!db.from("customer").eq("id", c.customerId).count()) throw new CounterError("Customer not found.");
  const { customerId, ...rest } = c;
  const had = db.from("distChemist").eq("id", customerId).count() > 0;
  db.from("distChemist").upsert({ id: customerId, ...rest, ...(had ? {} : { status: "active" }) });
}
export function setChemistStatus(db: DriveDB, customerId: string, status: "active" | "hold" | "blocked", note: string) {
  if (!db.from("distChemist").eq("id", customerId).count()) throw new CounterError("Chemist not found.");
  if (status !== "active" && note.trim().length < 3) throw new CounterError("Say why the account is on hold or blocked.");
  db.from("distChemist").eq("id", customerId).update({ status, statusNote: note.trim() || null });
}

export const schemeInput = z.object({
  code: z.string().trim().toUpperCase().min(2).max(20), name: z.string().trim().min(2).max(80), kind: z.enum(["free", "discount"]),
  medicineId: z.string().nullable().default(null), companyId: z.string().nullable().default(null),
  buyQty: z.number().int().min(0).default(0), freeQty: z.number().int().min(0).default(0), discPct: z.number().min(0).max(100).default(0),
  minQty: z.number().int().min(1).default(1), customerIds: z.array(z.string()).default([]), validFrom: isoDate, validTo: isoDate,
}).refine((s) => !!s.medicineId !== !!s.companyId, "A scheme is for one product or one company.")
  .refine((s) => s.validTo >= s.validFrom, "The end date is before the start date.")
  .refine((s) => (s.kind === "free" ? s.buyQty > 0 && s.freeQty > 0 : s.discPct > 0), "Enter the free goods (buy X get Y) or the discount.");
export function saveScheme(db: DriveDB, raw: z.input<typeof schemeInput>) {
  const s = schemeInput.parse(raw);
  if (db.engine.all("SELECT 1 FROM distScheme WHERE deletedAt IS NULL AND code = ?", [s.code]).length) throw new CounterError(`Scheme code ${s.code} is taken.`);
  return db.from<{ id: string }>("distScheme").insert({ ...s, customerIds: JSON.stringify(s.customerIds), active: 1 })[0].id;
}
export const endScheme = (db: DriveDB, id: string) => db.from("distScheme").eq("id", id).update({ active: 0 });

/** A chemist's own rate for a product (until `validTo`, or open-ended). */
export function setSpecialRate(db: DriveDB, customerId: string, medicineId: string, ratePaise: number, validTo: string | null) {
  if (!Number.isInteger(ratePaise) || ratePaise <= 0) throw new CounterError("Enter a valid rate.");
  db.from("distSpecialRate").upsert({ id: `${customerId}:${medicineId}`, customerId, medicineId, ratePaise, validTo });
}

export function activeSchemes(db: DriveDB, today: string): Scheme[] {
  return db.engine.all<Record<string, string | number | null>>("SELECT * FROM distScheme WHERE deletedAt IS NULL AND active = 1 AND validFrom <= ?1 AND validTo >= ?1", [today])
    .map((s) => ({ id: String(s.id), code: String(s.code), name: String(s.name), kind: s.kind as Scheme["kind"], medicineId: (s.medicineId as string) ?? null, companyId: (s.companyId as string) ?? null,
      buyQty: n(s.buyQty), freeQty: n(s.freeQty), discPct: n(s.discPct), minQty: n(s.minQty), customerIds: JSON.parse(String(s.customerIds ?? "[]")) as string[],
      validFrom: String(s.validFrom), validTo: String(s.validTo), active: true }));
}

// ---------- credit ----------

export type ChemistRow = { id: string; name: string; gstin: string | null; creditLimitPaise: number; stateCode: string | null; dlExpiry: string | null; creditDays: number; graceDays: number; priceTier: string; status: string; salesmanId: string | null };
export function chemist(db: DriveDB, customerId: string): ChemistRow {
  const c = db.engine.all<ChemistRow>(
    `SELECT c.id, c.name, c.gstin, c.creditLimitPaise, d.stateCode, d.dlExpiry, d.creditDays, d.graceDays, d.priceTier, d.status, d.salesmanId
       FROM customer c JOIN distChemist d ON d.id = c.id WHERE c.id = ? AND c.deletedAt IS NULL AND d.deletedAt IS NULL`, [customerId])[0];
  if (!c) throw new CounterError("Chemist not found.");
  return c;
}

/** Credit control for a chemist and a new bill of `value` paise (same rules as the server's creditFor). */
export function creditFor(db: DriveDB, customerId: string, value: number, today = todayISO(), exceptOrderId?: string): CreditDecision & { balance: number; limit: number } {
  const c = chemist(db, customerId);
  const balance = customerBalance(db, customerId);
  const invoices = db.engine.all<{ id: string; no: string; date: string; dueDate: string; total: number }>(
    `SELECT i.id, i.no, i.date, i.dueDate, i.totalPaise AS total FROM distInvoice i
      WHERE i.customerId = ? AND NOT EXISTS (SELECT 1 FROM distInvoiceCancel x WHERE x.invoiceId = i.id) ORDER BY i.date DESC LIMIT 500`, [customerId]);
  const open = ageOpenBills(invoices.map((i) => ({ ...i, total: n(i.total) })), balance, today).filter((b) => b.id !== "opening");
  const since = addDays(today, -90);
  const bounces = n(db.engine.all<{ v: number }>(
    `SELECT COUNT(*) AS v FROM chequeEvent e JOIN cheque q ON q.id = e.chequeId WHERE q.customerId = ? AND e.kind = 'bounced' AND e.day >= ?`, [customerId, since])[0]?.v);
  const d = creditCheck({ limit: n(c.creditLimitPaise), balance, orderValue: value, pendingOrders: pendingOrdersOf(db, customerId, exceptOrderId), oldestOpenDays: open[0] ? open[0].ageDays : null,
    creditDays: n(c.creditDays), graceDays: n(c.graceDays), status: c.status, dlExpiry: c.dlExpiry, bouncedCheques90d: bounces, today });
  return { ...d, balance, limit: n(c.creditLimitPaise) };
}

/** Value of the chemist's approved orders not yet invoiced (what they will owe soon). */
function pendingOrdersOf(db: DriveDB, customerId: string, exceptOrderId?: string) {
  return n(db.engine.all<{ v: number }>(
    `SELECT COALESCE(SUM(o.estimatePaise), 0) AS v FROM distOrder o
      WHERE o.customerId = ? AND o.id <> ? AND EXISTS (SELECT 1 FROM distOrderEvent e WHERE e.orderId = o.id AND e.kind = 'approved')
        AND NOT EXISTS (SELECT 1 FROM distOrderEvent e WHERE e.orderId = o.id AND e.kind IN ('invoiced', 'cancelled'))`, [customerId, exceptOrderId ?? ""])[0]?.v);
}

/** Stock units promised to approved orders not yet invoiced or cancelled, per batch (open pick lines). */
export function reservedUnits(db: DriveDB, exceptOrderId?: string): Record<string, number> {
  return Object.fromEntries(db.engine.all<{ id: string; u: number }>(
    `SELECT pl.batchId AS id, SUM(pl.units) AS u FROM distPickLine pl
      WHERE pl.orderId <> ? AND NOT EXISTS (SELECT 1 FROM distOrderEvent e WHERE e.orderId = pl.orderId AND e.kind IN ('invoiced', 'cancelled'))
      GROUP BY pl.batchId`, [exceptOrderId ?? ""]).map((r) => [r.id, n(r.u)]));
}

// ---------- invoicing ----------

export const directInput = z.object({
  branchId: z.string().min(1), customerId: z.string().min(1, "Choose the chemist."), userId: z.string().min(1),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, "Missing bill key; start a new bill."),
  /** The user may override credit holds and rates (Manager / Owner). */
  canOverride: z.boolean().default(false),
  overrideReason: z.string().trim().max(200).default(""),
  lines: z.array(z.object({
    medicineId: z.string().min(1), qty: z.number().int().min(1, "Quantity must be at least 1."), batchId: z.string().default(""),
    ratePaise: z.number().int().optional(), discPct: z.number().min(0).max(100).optional(),
  })).min(1, "Add at least one product.").max(300),
});
export type DistDirectInput = z.input<typeof directInput>;
export type PostLine = { medicineId: string; batchId: string; paidUnits: number; units: number; rate: number; discPct: number; schemeId: string | null };
export type Med = { id: string; name: string; gstRate: number; packSize: number };
export type BatchRow = { id: string; branchId: string; medicineId: string; batchNo: string; expiryDate: string; costPaise: number; mrpPaise: number; status: string };

export const stockOf = (db: DriveDB, ids: string[]) => new Map(ids.length ? db.engine.all<{ id: string; q: number }>(
  `SELECT batchId AS id, COALESCE(SUM(qty), 0) AS q FROM stockMovement WHERE batchId IN (${ids.map(() => "?").join(", ")}) GROUP BY batchId`, ids).map((r) => [r.id, n(r.q)]) : []);

/**
 * A counter / phone bill to a chemist without a separate order (the server's directInvoice). Returns the invoice;
 * a retried bill with the same key returns the first one.
 */
export function directInvoice(db: DriveDB, raw: DistDirectInput, today = todayISO()) {
  const i = directInput.parse(raw);
  const seen = db.engine.all<{ id: string; no: string; totalPaise: number }>("SELECT id, no, totalPaise FROM distInvoice WHERE idempotencyKey = ?", [i.idempotencyKey])[0];
  if (seen) return { invoiceId: seen.id, no: seen.no, total: n(seen.totalPaise), replayed: true };
  return db.transaction(() => {
    const chem = chemist(db, i.customerId);
    const settings = distSettings(db);
    const ids = [...new Set(i.lines.map((l) => l.medicineId))];
    if (ids.length !== i.lines.length) throw new CounterError("A product appears twice. Combine the lines.");
    const q = (sql: string) => sql.replace("(?)", `(${ids.map(() => "?").join(", ")})`);
    const meds = new Map(db.engine.all<Med>(q("SELECT id, name, gstRate, packSize FROM medicine WHERE id IN (?)"), ids).map((m) => [m.id, m]));
    const terms = new Map(db.engine.all<{ id: string; companyId: string | null; ptrPaise: number; ptsPaise: number; discontinued: number }>(q("SELECT id, companyId, ptrPaise, ptsPaise, discontinued FROM distProduct WHERE deletedAt IS NULL AND id IN (?)"), ids).map((d) => [d.id, d]));
    const specials = new Map(db.engine.all<{ medicineId: string; ratePaise: number; validTo: string | null }>(
      q("SELECT medicineId, ratePaise, validTo FROM distSpecialRate WHERE deletedAt IS NULL AND customerId = ? AND medicineId IN (?)"), [chem.id, ...ids]).map((s) => [s.medicineId, s]));
    const schemes = activeSchemes(db, today);
    const batches = db.engine.all<BatchRow>(q("SELECT id, branchId, medicineId, batchNo, expiryDate, costPaise, mrpPaise, status FROM batch WHERE deletedAt IS NULL AND medicineId IN (?)"), ids).filter((b) => b.branchId === i.branchId);
    const stock = stockOf(db, batches.map((b) => b.id));
    const alloc: AllocBatch[] = batches.map((b) => ({ id: b.id, medicineId: b.medicineId, batchNo: b.batchNo, expiry: b.expiryDate, qtyAvailable: stock.get(b.id) ?? 0, status: b.status }));
    // Stock promised to approved orders isn't free for a counter bill.
    const reserved = reservedUnits(db);
    const lines: PostLine[] = [], overrides: string[] = [];
    for (const l of i.lines) {
      const m = meds.get(l.medicineId), d = terms.get(l.medicineId), name = m?.name ?? "Product";
      if (!m) throw new CounterError("Medicine not found.");
      if (!d) throw new CounterError(`${name} has no wholesale rate. Set it up under Products.`);
      if (n(d.discontinued)) throw new CounterError(`${name} is discontinued.`);
      const pack = Math.max(1, n(m.packSize));
      const sp = specials.get(l.medicineId);
      const listRate = rateFor({ ptr: n(d.ptrPaise), pts: n(d.ptsPaise) }, chem.priceTier, sp ? { rate: n(sp.ratePaise), validTo: sp.validTo } : null, today);
      const sch = bestScheme(schemes, { medicineId: l.medicineId, companyId: d.companyId, qty: l.qty, customerId: chem.id }, today);
      const rate = l.ratePaise ?? listRate, disc = l.discPct ?? sch.discPct;
      if (!Number.isInteger(rate) || rate <= 0) throw new CounterError(`${name}: enter a valid rate.`);
      if (rate < listRate || disc > sch.discPct) overrides.push(`${name} rate ₹${(rate / 100).toFixed(2)} (list ₹${(listRate / 100).toFixed(2)}) disc ${disc}%`);
      const units = (l.qty + sch.freeQty) * pack;
      let allocs;
      try {
        if (l.batchId) {
          const b = alloc.find((x) => x.id === l.batchId && x.medicineId === l.medicineId);
          if (!b) throw new CounterError(`${name}: that batch isn’t in this godown.`);
          allocs = allocateFefoReserved([b], l.medicineId, units, { reserved, today, minShelfDays: 1, packSize: pack });
        } else allocs = allocateFefoReserved(alloc, l.medicineId, units, { reserved, today, minShelfDays: settings.minShelfDays, packSize: pack });
      } catch (e) {
        if (e instanceof ShortStockError) throw new CounterError(`${name}: only ${e.available} packs available${sch.freeQty ? ` (needed ${l.qty} + ${sch.freeQty} free)` : ""}.`);
        throw e;
      }
      for (const a of splitPaidFree(allocs, l.qty * pack)) {
        reserved[a.batchId] = (reserved[a.batchId] ?? 0) + a.units;
        lines.push({ medicineId: l.medicineId, batchId: a.batchId, units: a.units, paidUnits: a.paidUnits, rate, discPct: disc, schemeId: sch.schemeId });
      }
    }
    if (overrides.length && !i.canOverride) throw new CounterError(`Rates below the chemist’s rate need a manager: ${overrides.join("; ")}.`);
    const inter = isInterState(settings.stateCode, chem);
    const value = invoiceTotals(lines.filter((l) => l.paidUnits > 0).map((l) => { const m = meds.get(l.medicineId)!; return { qty: l.paidUnits / Math.max(1, n(m.packSize)), rate: l.rate, gstRate: n(m.gstRate), discPct: l.discPct }; }), inter).total;
    const credit = creditFor(db, chem.id, value, today);
    if (credit.hard) throw new CounterError(`Can’t bill: ${credit.reasons.join(" ")}`);
    if (!credit.ok) {
      if (!i.canOverride || i.overrideReason.length < 5) throw new CounterError(`Credit hold: ${credit.reasons.join(" ")} ${i.canOverride ? "Enter a reason to override." : "A manager with credit override must bill this."}`);
      if (settings.creditMode === "block") throw new CounterError(`Credit rules block this bill: ${credit.reasons.join(" ")}`);
    }
    const r = postInvoice(db, { branchId: i.branchId, chem, inter, lines, meds, batches, stock, userId: i.userId, idempotencyKey: i.idempotencyKey, today,
      note: [!credit.ok ? `over credit hold: ${i.overrideReason}` : "", overrides.length ? `rate override: ${overrides.join("; ")}` : ""].filter(Boolean).join(" · ") || null });
    return { ...r, replayed: false, overridden: !credit.ok || overrides.length > 0 };
  });
}

export const isInterState = (own: string | null, chem: { stateCode: string | null; gstin: string | null }) => {
  const theirs = chem.stateCode ?? chem.gstin?.slice(0, 2) ?? own;
  return !!own && !!theirs && own !== theirs;
};

export function postInvoice(db: DriveDB, a: { orderId?: string | null; branchId: string; chem: ChemistRow; inter: boolean; lines: PostLine[]; meds: Map<string, Med>; batches: BatchRow[]; stock: Map<string, number>; userId: string; idempotencyKey: string; today: string; note: string | null }) {
  const priced = a.lines.map((l) => {
    const m = a.meds.get(l.medicineId)!, b = a.batches.find((x) => x.id === l.batchId);
    if (!b || b.branchId !== a.branchId || b.medicineId !== m.id) throw new CounterError(`${m.name}: batch not found in this godown.`);
    if (b.status !== "ok") throw new CounterError(`${m.name} batch ${b.batchNo} is ${b.status}.`);
    if (b.expiryDate <= a.today) throw new CounterError(`${m.name} batch ${b.batchNo} has expired.`);
    if ((a.stock.get(b.id) ?? 0) < l.units) throw new CounterError(`${m.name} batch ${b.batchNo}: only ${a.stock.get(b.id) ?? 0} in stock.`);
    const pack = Math.max(1, n(m.packSize));
    if (l.units % pack || l.paidUnits % pack) throw new CounterError(`${m.name}: quantities must be whole packs.`);
    return { l, m, b, qty: l.paidUnits / pack, free: (l.units - l.paidUnits) / pack };
  });
  const paidIdx = priced.map((p, i) => (p.qty > 0 ? i : -1)).filter((i) => i >= 0);
  if (!paidIdx.length) throw new CounterError("An invoice needs at least one paid line.");
  const t = invoiceTotals(paidIdx.map((i) => ({ qty: priced[i].qty, rate: priced[i].l.rate, gstRate: n(priced[i].m.gstRate), discPct: priced[i].l.discPct })), a.inter);
  const lineTotals = new Map(paidIdx.map((i, k) => [i, t.lines[k]]));
  const cost = priced.reduce((s, p) => s + (p.qty + p.free) * n(p.b.costPaise), 0);
  const fy = fiscalYear(a.today);
  const no = gstDocNo(distSeries(db), fy, db.nextSeq(`DINV:${fy}`), 5);
  const at = new Date().toISOString();
  const inv = db.from<{ id: string }>("distInvoice").insert({
    branchId: a.branchId, deviceId: db.device, no, orderId: a.orderId ?? null, customerId: a.chem.id, salesmanId: a.chem.salesmanId, date: a.today, dueDate: addDays(a.today, n(a.chem.creditDays)),
    placeOfSupply: a.chem.stateCode ?? a.chem.gstin?.slice(0, 2) ?? null, customerGstin: a.chem.gstin, igst: a.inter ? 1 : 0,
    grossPaise: t.gross, discPaise: t.disc, taxablePaise: t.taxable, cgstPaise: t.cgst, sgstPaise: t.sgst, igstPaise: t.igst, roundOffPaise: t.roundOff, totalPaise: t.total,
    costPaise: cost, idempotencyKey: a.idempotencyKey, userId: a.userId, at,
  })[0];
  db.from("distInvoiceLine").insert(priced.map((p, i) => {
    const lt = lineTotals.get(i);
    return { invoiceId: inv.id, medicineId: p.m.id, batchId: p.b.id, qty: p.qty, freeQty: p.free, ratePaise: p.l.rate, mrpPaise: n(p.b.mrpPaise), discPct: p.l.discPct, discPaise: lt?.disc ?? 0,
      schemeId: p.l.schemeId, taxablePaise: lt?.taxable ?? 0, gstRate: n(p.m.gstRate), taxPaise: lt?.tax ?? 0, costPaise: (p.qty + p.free) * n(p.b.costPaise) };
  }));
  db.from("stockMovement").insert(priced.map((p) => ({ branchId: a.branchId, batchId: p.b.id, qty: -p.l.units, type: "sale", refType: "dist_invoice", refId: inv.id, userId: a.userId, at, note: a.note ? `${no} · ${a.note}`.slice(0, 200) : no })));
  return { invoiceId: inv.id, no, total: t.total };
}

/** Cancels today's invoice (later: a credit note): its stock goes back to the same batches. The invoice stays as it was. */
export function cancelInvoice(db: DriveDB, input: { invoiceId: string; reason: string; userId: string }, today = todayISO()) {
  const reason = input.reason.trim();
  if (reason.length < 5) throw new CounterError("Give the reason for cancelling.");
  return db.transaction(() => {
    const inv = db.engine.all<{ id: string; no: string; date: string; branchId: string }>("SELECT id, no, date, branchId FROM distInvoice WHERE id = ?", [input.invoiceId])[0];
    if (!inv) throw new CounterError("Invoice not found.");
    if (db.engine.all("SELECT 1 FROM distInvoiceCancel WHERE invoiceId = ?", [inv.id]).length) throw new CounterError(`${inv.no} is already cancelled.`);
    if (inv.date !== today) throw new CounterError("Only today’s invoices can be cancelled. Raise a credit note instead.");
    if (db.engine.all("SELECT 1 FROM distReturn WHERE invoiceId = ?", [inv.id]).length) throw new CounterError("This invoice has a credit note. It can’t be cancelled.");
    if (db.engine.all("SELECT 1 FROM distDeliveryEvent WHERE invoiceId = ? AND kind = 'delivered'", [inv.id]).length) throw new CounterError("Delivered invoices can’t be cancelled. Raise a credit note.");
    const at = new Date().toISOString();
    const moved = db.engine.all<{ batchId: string; qty: number }>("SELECT batchId, qty FROM stockMovement WHERE refType = 'dist_invoice' AND refId = ?", [inv.id]);
    db.from("stockMovement").insert(moved.map((m) => ({ branchId: inv.branchId, batchId: m.batchId, qty: -n(m.qty), type: "return", refType: "dist_invoice_cancel", refId: inv.id, userId: input.userId, at, note: `Cancelled ${inv.no}` })));
    // Fixed id: two counters cancelling the same invoice offline keep one cancellation after sync.
    db.from("distInvoiceCancel").insert({ id: `${inv.id}-cancel`, invoiceId: inv.id, reason, userId: input.userId, at });
    return inv.no;
  });
}

/** Invoices, newest first, with chemist name and whether cancelled. */
export function listInvoices(db: DriveDB, opts: { customerId?: string; from?: string; to?: string; limit?: number } = {}) {
  const where: string[] = [], args: (string | number)[] = [];
  if (opts.customerId) { where.push("i.customerId = ?"); args.push(opts.customerId); }
  if (opts.from) { where.push("i.date >= ?"); args.push(opts.from); }
  if (opts.to) { where.push("i.date <= ?"); args.push(opts.to); }
  args.push(Math.min(opts.limit ?? 200, 1000));
  return db.engine.all<{ id: string; no: string; date: string; dueDate: string; customerId: string; chemist: string; totalPaise: number; igst: number; cancelled: number }>(
    `SELECT i.id, i.no, i.date, i.dueDate, i.customerId, c.name AS chemist, i.totalPaise, i.igst,
            EXISTS (SELECT 1 FROM distInvoiceCancel x WHERE x.invoiceId = i.id) AS cancelled
       FROM distInvoice i JOIN customer c ON c.id = i.customerId ${where.length ? "WHERE " + where.join(" AND ") : ""}
      ORDER BY i.at DESC LIMIT ?`, args).map((r) => ({ ...r, totalPaise: n(r.totalPaise), igst: !!n(r.igst), cancelled: !!n(r.cancelled) }));
}

export type DistInvoiceRow = {
  id: string; branchId: string; deviceId: string; no: string; orderId: string | null; customerId: string; salesmanId: string | null; date: string; dueDate: string;
  placeOfSupply: string | null; customerGstin: string | null; igst: number; grossPaise: number; discPaise: number; taxablePaise: number; cgstPaise: number; sgstPaise: number;
  igstPaise: number; roundOffPaise: number; totalPaise: number; costPaise: number; idempotencyKey: string; userId: string; at: string;
};

/** One invoice with its lines, for printing. */
export function invoiceView(db: DriveDB, id: string) {
  const inv = db.engine.all<DistInvoiceRow>("SELECT * FROM distInvoice WHERE id = ?", [id])[0];
  if (!inv) return null;
  const lines = db.engine.all<Record<string, string | number | null>>(
    `SELECT l.*, m.name, m.hsn, m.packSize, b.batchNo, b.expiryDate FROM distInvoiceLine l JOIN medicine m ON m.id = l.medicineId JOIN batch b ON b.id = l.batchId WHERE l.invoiceId = ? ORDER BY l.rowid`, [id]);
  const cancel = db.engine.all<{ reason: string; at: string }>("SELECT reason, at FROM distInvoiceCancel WHERE invoiceId = ?", [id])[0] ?? null;
  return { ...inv, lines, cancelled: cancel };
}
