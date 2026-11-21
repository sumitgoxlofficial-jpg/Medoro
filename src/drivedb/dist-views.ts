/**
 * Read-only lists for the distribution screens on the device (phase D4): companies, products with their wholesale
 * terms and free stock, chemists with their profile and balance, schemes, and a live quote for a bill being typed.
 */
import { DriveDB } from "./client";
import { activeSchemes, chemist, distSettings, isInterState, reservedUnits, stockOf } from "./dist";
import { customerBalance } from "./trade";
import { todayISO } from "@/lib/dates";
import { invoiceTotals, rateFor } from "@/domain/distribution/rules/pricing";
import { bestScheme } from "@/domain/distribution/rules/schemes";

const n = (v: unknown) => Number(v ?? 0);

export const listCompanies = (db: DriveDB) =>
  db.engine.all<{ id: string; name: string; shortName: string | null; gstin: string | null; phone: string | null }>("SELECT id, name, shortName, gstin, phone FROM distCompany WHERE deletedAt IS NULL ORDER BY name COLLATE NOCASE");

/** Catalogue medicines with their wholesale terms (if any) and free packs in the godown. */
export function listProducts(db: DriveDB, branchId: string, q = "") {
  const like = `%${q.trim()}%`;
  const rows = db.engine.all<{ id: string; name: string; packSize: number; gstRate: number; mrpPaise: number; companyId: string | null; company: string | null; ptrPaise: number | null; ptsPaise: number | null; minOrderQty: number | null; portalVisible: number | null; discontinued: number | null }>(
    `SELECT m.id, m.name, m.packSize, m.gstRate, m.mrpPaise, d.companyId, c.name AS company, d.ptrPaise, d.ptsPaise, d.minOrderQty, d.portalVisible, d.discontinued
       FROM medicine m LEFT JOIN distProduct d ON d.id = m.id AND d.deletedAt IS NULL LEFT JOIN distCompany c ON c.id = d.companyId
      WHERE m.deletedAt IS NULL AND m.active = 1 AND (m.name LIKE ? OR m.generic LIKE ?) ORDER BY m.name COLLATE NOCASE LIMIT 300`, [like, like]);
  const batches = db.engine.all<{ id: string; medicineId: string }>(`SELECT id, medicineId FROM batch WHERE deletedAt IS NULL AND branchId = ? AND status = 'ok'`, [branchId]);
  const stock = stockOf(db, batches.map((b) => b.id)), held = reservedUnits(db);
  const free = new Map<string, number>();
  for (const b of batches) free.set(b.medicineId, (free.get(b.medicineId) ?? 0) + Math.max(0, (stock.get(b.id) ?? 0) - (held[b.id] ?? 0)));
  return rows.map((r) => ({
    ...r, packSize: Math.max(1, n(r.packSize)), gstRate: n(r.gstRate), mrpPaise: n(r.mrpPaise), wholesale: r.ptrPaise != null,
    ptrPaise: n(r.ptrPaise), ptsPaise: n(r.ptsPaise), minOrderQty: n(r.minOrderQty) || 1, portalVisible: r.portalVisible == null ? true : !!n(r.portalVisible), discontinued: !!n(r.discontinued),
    freePacks: Math.floor((free.get(r.id) ?? 0) / Math.max(1, n(r.packSize))),
  }));
}

/** Customers with their wholesale profile (if any) and what they owe. */
export function listChemists(db: DriveDB, q = "") {
  const like = `%${q.trim()}%`;
  return db.engine.all<{ id: string; name: string; phone: string | null; gstin: string | null; creditLimitPaise: number; profile: number; stateCode: string | null; dl20b: string | null; dl21b: string | null; dlExpiry: string | null;
    creditDays: number | null; graceDays: number | null; priceTier: string | null; status: string | null; statusNote: string | null; salesmanId: string | null; portalAccountId: string | null }>(
    `SELECT c.id, c.name, c.phone, c.gstin, c.creditLimitPaise, (d.id IS NOT NULL) AS profile, d.stateCode, d.dl20b, d.dl21b, d.dlExpiry, d.creditDays, d.graceDays, d.priceTier, d.status, d.statusNote, d.salesmanId, d.portalAccountId
       FROM customer c LEFT JOIN distChemist d ON d.id = c.id AND d.deletedAt IS NULL
      WHERE c.deletedAt IS NULL AND (c.name LIKE ? OR IFNULL(c.phone, '') LIKE ?) ORDER BY c.name COLLATE NOCASE LIMIT 500`, [like, like])
    .map((c) => ({ ...c, profile: !!n(c.profile), creditLimitPaise: n(c.creditLimitPaise), balancePaise: customerBalance(db, c.id) }));
}

export const listSchemes = (db: DriveDB) =>
  db.engine.all<{ id: string; code: string; name: string; kind: string; medicineId: string | null; companyId: string | null; buyQty: number; freeQty: number; discPct: number; minQty: number; validFrom: string; validTo: string; active: number; target: string | null }>(
    `SELECT s.*, COALESCE(m.name, c.name) AS target FROM distScheme s LEFT JOIN medicine m ON m.id = s.medicineId LEFT JOIN distCompany c ON c.id = s.companyId
      WHERE s.deletedAt IS NULL ORDER BY s.active DESC, s.validTo DESC`).map((s) => ({ ...s, active: !!n(s.active), discPct: n(s.discPct) }));

/** What a bill to this chemist would come to now: rate, scheme, GST and total per line (before stock is checked). */
export function quote(db: DriveDB, customerId: string, lines: { medicineId: string; qty: number }[], today = todayISO()) {
  const chem = chemist(db, customerId), schemes = activeSchemes(db, today);
  const inter = isInterState(distSettings(db).stateCode, chem);
  const out = lines.filter((l) => l.qty > 0).map((l) => {
    const d = db.engine.all<{ name: string; gstRate: number; companyId: string | null; ptrPaise: number | null; ptsPaise: number | null }>(
      "SELECT m.name, m.gstRate, d.companyId, d.ptrPaise, d.ptsPaise FROM medicine m LEFT JOIN distProduct d ON d.id = m.id AND d.deletedAt IS NULL WHERE m.id = ?", [l.medicineId])[0];
    if (!d || d.ptrPaise == null) return { ...l, name: d?.name ?? "—", rate: 0, discPct: 0, freeQty: 0, scheme: null as string | null, gstRate: n(d?.gstRate), problem: "No wholesale rate" };
    const sp = db.engine.all<{ ratePaise: number; validTo: string | null }>("SELECT ratePaise, validTo FROM distSpecialRate WHERE deletedAt IS NULL AND customerId = ? AND medicineId = ?", [customerId, l.medicineId])[0];
    const rate = rateFor({ ptr: n(d.ptrPaise), pts: n(d.ptsPaise) }, chem.priceTier, sp ? { rate: n(sp.ratePaise), validTo: sp.validTo } : null, today);
    const sch = bestScheme(schemes, { medicineId: l.medicineId, companyId: d.companyId, qty: l.qty, customerId }, today);
    return { ...l, name: d.name, rate, discPct: sch.discPct, freeQty: sch.freeQty, scheme: sch.label, gstRate: n(d.gstRate), problem: null as string | null };
  });
  const ok = out.filter((l) => !l.problem);
  const totals = ok.length ? invoiceTotals(ok.map((l) => ({ qty: l.qty, rate: l.rate, gstRate: l.gstRate, discPct: l.discPct })), inter) : null;
  return { lines: out, inter, total: totals?.total ?? 0, taxable: totals?.taxable ?? 0, tax: totals?.tax ?? 0, balancePaise: customerBalance(db, customerId), limitPaise: n(chem.creditLimitPaise), status: chem.status };
}
