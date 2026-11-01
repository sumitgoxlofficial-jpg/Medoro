/**
 * Loads a pharmacy's catalogue, stock and customers into an empty device database (Drive mode pilot), and
 * holds the device's counter settings. Ids are kept from the server so the later move to Drive lines up.
 */
import { DriveDB } from "./client";
import { CounterError, loyaltyOf, type Loyalty } from "./pharmacy";
import { validSeries } from "@/lib/docno";

export type Pharmacy = { name: string; tradeName: string; gstin: string; dl: string; address: string; phone: string };
export type Seed = {
  branch: { id: string; code: string; name: string };
  pharmacy?: Pharmacy;
  userName?: string;
  loyalty?: { enabled: boolean; earnPer100: number; pointValuePaise: number; minRedeem: number };
  /** Every branch (for transfers) and every user's name (for the activity log). */
  branches?: { id: string; name: string; code: string }[];
  users?: { id: string; name: string }[];
  maxDiscountPct: number;
  medicines: Record<string, string | number | boolean | null>[];
  batches: { id: string; medicineId: string; batchNo: string; expiryDate: string; costPaise: number; mrpPaise: number; status: string; qty: number }[];
  customers: { id: string; name: string; phone: string | null; gstin: string | null; creditLimitPaise: number }[];
};

export type CounterConfig = { branchId: string; branchName: string; series: string; maxDiscountPct: number; pharmacy: Pharmacy | null; userId: string | null; userName: string; pinSet: boolean; loyalty: Loyalty; branches: { id: string; name: string; code: string }[] };

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
    if (seed.pharmacy) db.setMeta("pharmacy", JSON.stringify(seed.pharmacy));
    if (seed.loyalty) db.setMeta("loyalty", JSON.stringify(seed.loyalty));
    if (seed.branches) db.setMeta("branches", JSON.stringify(seed.branches));
    if (seed.users) db.setMeta("users", JSON.stringify(seed.users));
    db.setMeta("userId", userId);
    db.setMeta("userName", seed.userName ?? "Owner");
  });
  return counterConfig(db)!;
}

/** This device's counter settings, or null if no catalogue was loaded yet. */
export function counterConfig(db: DriveDB): CounterConfig | null {
  const branchId = db.getMeta("branchId"), series = db.getMeta("series");
  if (!branchId || !series) return null;
  const ph = db.getMeta("pharmacy");
  return {
    branchId, series, branchName: db.getMeta("branchName") ?? "", maxDiscountPct: Number(db.getMeta("maxDiscountPct") ?? 100),
    pharmacy: ph ? (JSON.parse(ph) as Pharmacy) : null, userId: db.getMeta("userId"), userName: db.getMeta("userName") ?? "", pinSet: !!db.getMeta("pinHash"), loyalty: loyaltyOf(db),
    branches: JSON.parse(db.getMeta("branches") ?? "[]"),
  };
}

/** Latest bills on this device, newest first. */
export function recentSales(db: DriveDB, limit = 20) {
  return db.engine.all<{ id: string; invoiceNo: string; totalPaise: number; payMode: string; at: string; customer: string | null; items: number }>(
    `SELECT s.id, s.invoiceNo, s.totalPaise, s.payMode, s.at, c.name AS customer, (SELECT COUNT(*) FROM saleItem i WHERE i.saleId = s.id) AS items
       FROM sale s LEFT JOIN customer c ON c.id = s.customerId ORDER BY s.at DESC, s.invoiceNo DESC LIMIT ?`, [limit]);
}

// ---------- counter PIN (needed to open the device screen without signing in, e.g. offline) ----------

const b64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
async function pinHash(pin: string, salt: Uint8Array) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: new Uint8Array(salt), iterations: 150_000 }, key, 256));
}
const PIN_RE = /^\d{4,8}$/;

/** Sets the counter PIN (4–8 digits). Stored only as a salted hash on this device. */
export async function setPin(db: DriveDB, pin: string) {
  if (!PIN_RE.test(pin)) throw new CounterError("Use a PIN of 4 to 8 digits.");
  const salt = crypto.getRandomValues(new Uint8Array(16));
  db.setMeta("pinHash", `${b64(salt)}:${b64(await pinHash(pin, salt))}`);
  db.setMeta("pinFails", "0");
  return true;
}

/** Checks the counter PIN. After 5 wrong tries the PIN is refused for 5 minutes. */
export async function checkPin(db: DriveDB, pin: string, now = Date.now()): Promise<boolean> {
  const stored = db.getMeta("pinHash");
  if (!stored) throw new CounterError("No counter PIN is set on this device. Sign in to Medoro to use it.");
  const until = Number(db.getMeta("pinLockedUntil") ?? 0);
  if (until > now) throw new CounterError(`Too many wrong PINs. Try again in ${Math.ceil((until - now) / 60_000)} min.`);
  const [salt, hash] = stored.split(":");
  const got = b64(await pinHash(pin, unb64(salt)));
  if (got === hash) { db.setMeta("pinFails", "0"); return true; }
  const fails = Number(db.getMeta("pinFails") ?? 0) + 1;
  db.setMeta("pinFails", String(fails >= 5 ? 0 : fails));
  if (fails >= 5) db.setMeta("pinLockedUntil", String(now + 5 * 60_000));
  return false;
}
