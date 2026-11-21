/**
 * The chemist portal for a distributor whose records are in its own Drive (phase D5, option 1 of
 * docs/DIST_DRIVE_PLAN.md). This device:
 *   - builds the catalogue Medoro may show chemists (products, PTR / PTS, MRP if shown, stock as the distributor chose
 *     to show it, schemes open to every chemist, each portal chemist's price tier) — no bills, balances, purchase prices
 *     or chemist-specific rates;
 *   - takes in portal orders (and cancellations) that Medoro sealed for this device, as ordinary orders that wait for
 *     approval, with the same credit rules;
 *   - reports each portal order's status (order and invoice numbers, invoice total) so the chemist can follow it.
 * Server side: src/domain/distribution/drive-portal.ts.
 */
import { z } from "zod";
import { DriveDB } from "./client";
import { CounterError } from "./pharmacy";
import { activeSchemes, distSettings, reservedUnits, stockOf } from "./dist";
import { addCustomer } from "./trade";
import { cancelOrder, placeOrder, statusOf } from "./dist-orders";
import { addDays, todayISO } from "@/lib/dates";
import { stockBand, type StockView } from "@/domain/distribution/portal-rules";
import type { OrderStatus } from "@/domain/distribution/rules/orderflow";

const n = (v: unknown) => Number(v ?? 0);

export type PortalItem = {
  medicineId: string; name: string; generic: string; pack: string; company: string | null; gstRate: number;
  ptr: number; pts: number; mrp: number | null; minOrderQty: number; stock: StockView; schemes: string[];
};
export type PortalCatalogue = { items: PortalItem[]; tiers: Record<string, "ptr" | "pts">; enabled: boolean; minOrderPaise: number };

/** What Medoro may show chemists for this distributor. Stock is free packs in the godown (`branchId`), as the distributor chose to show it. */
export function buildCatalogue(db: DriveDB, branchId: string, today = todayISO()): PortalCatalogue {
  const s = distSettings(db);
  const rows = db.engine.all<{ id: string; name: string; generic: string; packSize: number; packUnit: string; gstRate: number; mrpPaise: number; ptrPaise: number; ptsPaise: number; minOrderQty: number; companyId: string | null; company: string | null }>(
    `SELECT m.id, m.name, m.generic, m.packSize, m.packUnit, m.gstRate, m.mrpPaise, d.ptrPaise, d.ptsPaise, d.minOrderQty, d.companyId, c.name AS company
       FROM distProduct d JOIN medicine m ON m.id = d.id LEFT JOIN distCompany c ON c.id = d.companyId
      WHERE d.deletedAt IS NULL AND d.portalVisible = 1 AND d.discontinued = 0 AND m.active = 1 AND m.deletedAt IS NULL ORDER BY m.name`);
  // Free packs: stock in batches with enough shelf life, less what approved orders hold.
  const cutoff = addDays(today, Math.max(1, s.minShelfDays));
  const batches = db.engine.all<{ id: string; medicineId: string }>(`SELECT id, medicineId FROM batch WHERE deletedAt IS NULL AND branchId = ? AND status = 'ok' AND expiryDate >= ?`, [branchId, cutoff]);
  const stock = stockOf(db, batches.map((b) => b.id)), held = reservedUnits(db);
  const free = new Map<string, number>();
  for (const b of batches) free.set(b.medicineId, (free.get(b.medicineId) ?? 0) + Math.max(0, (stock.get(b.id) ?? 0) - (held[b.id] ?? 0)));
  // Only schemes open to every chemist are published; chemist-specific ones apply when the order is approved.
  const schemes = s.portal.showSchemes ? activeSchemes(db, today).filter((x) => !x.customerIds.length) : [];
  const items = rows.map((r): PortalItem => {
    const pack = Math.max(1, n(r.packSize));
    const sch = schemes.filter((x) => x.medicineId === r.id || (!x.medicineId && x.companyId && x.companyId === r.companyId));
    return {
      medicineId: r.id, name: r.name, generic: r.generic ?? "", pack: pack > 1 ? `${r.packUnit} of ${pack}` : r.packUnit, company: r.company, gstRate: n(r.gstRate),
      ptr: n(r.ptrPaise), pts: n(r.ptsPaise), mrp: s.portal.showMrp ? n(r.mrpPaise) : null, minOrderQty: Math.max(1, n(r.minOrderQty)),
      stock: stockBand(Math.floor((free.get(r.id) ?? 0) / pack), s.portal.stock),
      schemes: sch.map((x) => (x.kind === "free" ? `${x.buyQty}+${x.freeQty}` : `${x.discPct}% off`) + (x.minQty > 1 ? ` (min ${x.minQty})` : "")),
    };
  });
  const tiers = Object.fromEntries(db.engine.all<{ a: string; t: "ptr" | "pts" }>("SELECT portalAccountId AS a, priceTier AS t FROM distChemist WHERE deletedAt IS NULL AND portalAccountId IS NOT NULL").map((r) => [r.a, r.t]));
  return { items, tiers, enabled: s.portal.enabled, minOrderPaise: s.portal.minOrderPaise };
}

// ---------- portal chemists ----------

export const portalChemistInput = z.object({
  accountId: z.string().min(1), firmName: z.string().trim().min(2), ownerName: z.string().trim().default(""), phone: z.string().trim().min(10),
  gstin: z.string().trim().nullable().default(null), dl20b: z.string().trim().min(3), dl21b: z.string().trim().min(3), dlExpiry: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  address: z.string().trim().default(""), pincode: z.string().trim().default(""), stateCode: z.string().regex(/^\d{2}$/),
  creditLimitPaise: z.number().int().min(0).default(0), creditDays: z.number().int().min(0).max(180).default(21),
  /** Link to a chemist already on this device instead of adding one. */
  customerId: z.string().default(""),
});

/**
 * Approving a portal chemist: links the request to a chemist already here, or adds one from the details the chemist
 * shared. Returns the chemist (customer) id, which Medoro records against the portal connection.
 */
export function addPortalChemist(db: DriveDB, raw: z.input<typeof portalChemistInput>, today = todayISO()) {
  const a = portalChemistInput.parse(raw);
  if (a.dlExpiry < today) throw new CounterError(`Drug licence expired on ${a.dlExpiry}.`);
  return db.transaction(() => {
    const linked = db.engine.all<{ id: string }>("SELECT id FROM distChemist WHERE deletedAt IS NULL AND portalAccountId = ?", [a.accountId])[0];
    if (linked) return linked.id;
    if (a.customerId) {
      const ch = db.engine.all<{ portalAccountId: string | null }>("SELECT portalAccountId FROM distChemist WHERE id = ? AND deletedAt IS NULL", [a.customerId])[0];
      if (!ch) throw new CounterError("Chemist not found.");
      if (ch.portalAccountId && ch.portalAccountId !== a.accountId) throw new CounterError("That chemist is already linked to another portal account.");
      db.from("distChemist").eq("id", a.customerId).update({ portalAccountId: a.accountId });
      return a.customerId;
    }
    const c = addCustomer(db, { name: a.firmName, phone: a.phone, gstin: a.gstin, creditLimitPaise: a.creditLimitPaise });
    db.from("customer").eq("id", c.id).update({ address: a.address || null, pincode: a.pincode || null });
    db.from("distChemist").upsert({ id: c.id, ownerName: a.ownerName || null, stateCode: a.stateCode, dl20b: a.dl20b, dl21b: a.dl21b, dlExpiry: a.dlExpiry, creditDays: a.creditDays, graceDays: 7,
      priceTier: "ptr", status: "active", portalAccountId: a.accountId });
    return c.id;
  });
}

// ---------- orders from the portal ----------

export type PortalMessage =
  | { kind: "order"; key: string; accountId: string; customerId: string; lines: { medicineId: string; qty: number }[]; note: string; at: string }
  | { kind: "cancel"; key: string; accountId: string; customerId: string; at: string };
export type PortalStatus = { key: string; status: OrderStatus; orderNo: string | null; invoiceNo: string | null; invoiceTotalPaise: number | null; reason: string | null };

/**
 * Takes in what Medoro sealed for this device. Returns the messages that are done (Medoro deletes them) and statuses to
 * report now (an order refused outright, e.g. an expired drug licence). A message for a chemist this device doesn't
 * have yet waits for sync.
 */
export function ingestPortal(db: DriveDB, branchId: string, userId: string, msgs: PortalMessage[], today = todayISO()) {
  const done: string[] = [], statuses: PortalStatus[] = [];
  const linked = (m: PortalMessage) => db.engine.all("SELECT 1 FROM distChemist WHERE id = ? AND portalAccountId = ? AND deletedAt IS NULL", [m.customerId, m.accountId]).length > 0;
  for (const m of msgs) {
    if (!/^[A-Za-z0-9_-]{8,64}$/.test(m.key)) { done.push(m.key); continue; }
    if (!linked(m)) continue;
    if (m.kind === "order") {
      try {
        placeOrder(db, { branchId, customerId: m.customerId, userId, source: "portal", placedByType: "chemist", placedById: m.accountId, note: m.note.slice(0, 300), idempotencyKey: m.key, lines: m.lines }, today);
      } catch (e) {
        if (!(e instanceof CounterError)) throw e;
        statuses.push({ key: m.key, status: "rejected", orderNo: null, invoiceNo: null, invoiceTotalPaise: null, reason: e.message });
      }
      done.push(m.key);
    } else {
      const o = db.engine.all<{ id: string }>("SELECT id FROM distOrder WHERE idempotencyKey = ? AND placedById = ?", [m.key, m.accountId])[0];
      if (o && statusOf(db, o.id) === "pending") cancelOrder(db, { orderId: o.id, reason: "Cancelled by chemist", userId });
      done.push(`${m.key}:cancel`);
    }
  }
  return { done, statuses };
}

/** Status of every portal order (newest 500), to report to the chemist. */
export function portalStatuses(db: DriveDB): PortalStatus[] {
  const rows = db.engine.all<{ id: string; no: string; idempotencyKey: string }>("SELECT id, no, idempotencyKey FROM distOrder WHERE source = 'portal' ORDER BY at DESC LIMIT 500");
  return rows.map((o) => {
    const ev = db.engine.all<{ kind: string; reason: string | null; invoiceId: string | null }>("SELECT kind, reason, invoiceId FROM distOrderEvent WHERE orderId = ?", [o.id]);
    const inv = ev.find((e) => e.kind === "invoiced");
    const i = inv?.invoiceId ? db.engine.all<{ no: string; totalPaise: number }>("SELECT no, totalPaise FROM distInvoice WHERE id = ?", [inv.invoiceId])[0] : undefined;
    const why = ev.find((e) => e.kind === "rejected" || e.kind === "cancelled")?.reason ?? null;
    return { key: o.idempotencyKey, status: statusOf(db, o.id), orderNo: o.no, invoiceNo: i?.no ?? null, invoiceTotalPaise: i ? n(i.totalPaise) : null, reason: why };
  });
}
