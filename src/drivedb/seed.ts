/**
 * Loads a pharmacy's catalogue, stock and customers into an empty device database (Drive mode pilot), and
 * holds the device's counter settings. Ids are kept from the server so the later move to Drive lines up.
 */
import { DriveDB } from "./client";
import { CounterError } from "./pharmacy";
import { validSeries } from "@/lib/docno";

export type Seed = {
  branch: { id: string; code: string; name: string };
  maxDiscountPct: number;
  medicines: Record<string, string | number | boolean | null>[];
  batches: { id: string; medicineId: string; batchNo: string; expiryDate: string; costPaise: number; mrpPaise: number; status: string; qty: number }[];
  customers: { id: string; name: string; phone: string | null; gstin: string | null; creditLimitPaise: number }[];
};

export type CounterConfig = { branchId: string; branchName: string; series: string; maxDiscountPct: number };

/** A counter series for this device: "D" + 4 letters/digits from its id, e.g. DK3F9 (fits the GST 16-character limit). */
export const seriesFor = (device: string) => ("D" + device.replace(/[^A-Z0-9]/gi, "").toUpperCase().slice(-4)).padEnd(5, "0");

export function importSeed(db: DriveDB, seed: Seed, userId: string): CounterConfig {
  if (db.from("medicine").withDeleted().count() > 0) throw new CounterError("This device already has a catalogue. Reset it first to load again.");
  const series = seriesFor(db.device);
  if (!validSeries(series)) throw new CounterError("Couldn’t make a counter series for this device.");
  const at = new Date().toISOString();
  db.transaction(() => {
    if (seed.medicines.length) db.from("medicine").insert(seed.medicines.map((m) => ({ ...m, active: true })));
    if (seed.batches.length) {
      db.from("batch").insert(seed.batches.map((b) => ({ id: b.id, medicineId: b.medicineId, batchNo: b.batchNo, expiryDate: b.expiryDate, costPaise: b.costPaise, mrpPaise: b.mrpPaise, status: b.status, branchId: seed.branch.id, supplierId: null })));
      db.from("stockMovement").insert(seed.batches.map((b) => ({ branchId: seed.branch.id, batchId: b.id, qty: b.qty, type: "opening", refType: "opening", refId: b.id, userId, at, note: "Copied from Medoro" })));
    }
    if (seed.customers.length) db.from("customer").insert(seed.customers);
    db.setMeta("branchId", seed.branch.id);
    db.setMeta("branchName", seed.branch.name);
    db.setMeta("series", series);
    db.setMeta("maxDiscountPct", String(seed.maxDiscountPct));
  });
  return counterConfig(db)!;
}

/** This device's counter settings, or null if no catalogue was loaded yet. */
export function counterConfig(db: DriveDB): CounterConfig | null {
  const branchId = db.getMeta("branchId"), series = db.getMeta("series");
  if (!branchId || !series) return null;
  return { branchId, series, branchName: db.getMeta("branchName") ?? "", maxDiscountPct: Number(db.getMeta("maxDiscountPct") ?? 100) };
}

/** Latest bills on this device, newest first. */
export function recentSales(db: DriveDB, limit = 20) {
  return db.engine.all<{ id: string; invoiceNo: string; totalPaise: number; payMode: string; at: string; customer: string | null; items: number }>(
    `SELECT s.id, s.invoiceNo, s.totalPaise, s.payMode, s.at, c.name AS customer, (SELECT COUNT(*) FROM saleItem i WHERE i.saleId = s.id) AS items
       FROM sale s LEFT JOIN customer c ON c.id = s.customerId ORDER BY s.at DESC, s.invoiceNo DESC LIMIT ?`, [limit]);
}
