/// <reference lib="webworker" />
/**
 * Runs the pharmacy database on this device, in a background worker, stored in the browser's private
 * storage (OPFS). Pages talk to it through src/drivedb/device.ts. Nothing here goes to Medoro's server.
 */
import { DriveDB } from "./client";
import { wasmEngine, type WasmDb } from "./engine";
import * as pharmacy from "./pharmacy";
import * as trade from "./trade";
import * as seed from "./seed";
import * as reports from "./reports";
import * as sync from "./sync";
import { googleStore, DriveAuthError, type DriveStore } from "./drive";

type Pool = { OpfsSAHPoolDb: new (file: string) => WasmDb; wipeFiles(): Promise<void>; importDb(name: string, bytes: Uint8Array): Promise<number> | number };
type Sqlite = { capi: { sqlite3_js_db_export(db: WasmDb): Uint8Array }; installOpfsSAHPoolVfs(o: { name: string }): Promise<Pool> };
/** The pharmacy's database file; the device test page's demo uses its own file so sample data never mixes in. */
const FILES = { pharmacy: "/pharmacy.db", demo: "/demo.db" } as const;
let FILE: string = FILES.pharmacy;
let db: DriveDB | null = null;
let pool: Pool | null = null;
let sqlite: Sqlite | null = null;
let deviceName = "";

const openFile = () => DriveDB.open(wasmEngine(new pool!.OpfsSAHPoolDb(FILE), (d) => sqlite!.capi.sqlite3_js_db_export(d)), { device: deviceName });

async function open(device: string, which: keyof typeof FILES = "pharmacy") {
  if (!Object.prototype.hasOwnProperty.call(FILES, which)) throw new Error("Unknown database.");
  if (db && FILE === FILES[which]) return { device: db.device };
  if (db) { db.engine.close(); db = null; dataKey = null; }
  FILE = FILES[which];
  // The SQLite build is copied to /drivedb/sqlite at build time (scripts/copy-sqlite.mjs); load it as-is.
  const url = "/drivedb/sqlite/index.mjs";
  const mod = await import(/* webpackIgnore: true */ url);
  sqlite ??= (await mod.default()) as Sqlite;
  pool ??= await sqlite.installOpfsSAHPoolVfs({ name: "medoro-device" });
  deviceName = device;
  db = openFile();
  return { device: db.device };
}

// ---------- Google Drive (phase 2) ----------

/** This device's own key, kept in the browser's IndexedDB (it can't be read out, only used). */
const keys: sync.KeyStore = {
  get: () => idb<CryptoKey | null>("readonly", (s) => s.get("device")).then((k) => k ?? null),
  set: (k) => idb("readwrite", (s) => s.put(k, "device")).then(() => undefined),
};
function idb<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open("medoro-drivedb", 1);
    r.onupgradeneeded = () => r.result.createObjectStore("keys");
    r.onerror = () => reject(r.error);
    r.onsuccess = () => {
      const t = r.result.transaction("keys", mode), q = fn(t.objectStore("keys"));
      t.oncomplete = () => { r.result.close(); resolve(q.result as T); };
      t.onerror = () => { r.result.close(); reject(t.error); };
    };
  });
}

let access: { token: string; folderId: string; expiresAt: number } | null = null;
let dataKey: Uint8Array | null = null;
const state = { lastPush: null as string | null, lastSnapshot: null as string | null, lastError: null as string | null, busy: false };
const store = (): DriveStore => {
  if (!access) throw new Error("Google Drive isn’t connected on this device yet.");
  return googleStore(() => ({ token: access!.token, folderId: access!.folderId }));
};
const SNAPSHOT_EVERY = 6 * 3600_000;

async function syncNow(forceSnapshot = false) {
  if (!db || !dataKey || !access || state.busy || access.expiresAt < Date.now()) return state;
  state.busy = true;
  try {
    const last = db.getMeta("lastSnapshot");
    if (forceSnapshot || !last || Date.now() - Date.parse(last) > SNAPSHOT_EVERY) {
      const m = await sync.writeSnapshot(db, store(), dataKey, () => need().engine.exportBytes());
      state.lastSnapshot = m.snapshotAt;
    } else {
      while (await sync.pushChanges(db, store(), dataKey)) { /* until empty */ }
    }
    state.lastPush = new Date().toISOString();
    state.lastError = null;
  } catch (e) {
    state.lastError = e instanceof DriveAuthError ? e.message : `Couldn’t save to Google Drive: ${e instanceof Error ? e.message : String(e)}`;
  } finally { state.busy = false; }
  return state;
}
setInterval(() => { void syncNow(); }, 10_000);

const need = () => { if (!db) throw new Error("The device database isn’t open."); return db; };

const handlers = {
  open,
  addMedicine: (input: pharmacy.MedicineInput) => pharmacy.addMedicine(need(), input),
  receiveStock: (input: Parameters<typeof pharmacy.receiveStock>[1]) => pharmacy.receiveStock(need(), input),
  search: (text: string, branchId: string) => pharmacy.searchMedicines(need(), text).map((m) => ({ ...m, stock: pharmacy.stockOf(need(), m.id, branchId) })),
  createSale: (input: pharmacy.SaleInput) => pharmacy.createSale(need(), input),
  dayTotals: (branchId: string, iso: string) => pharmacy.dayTotals(need(), branchId, iso),
  addCustomer: (input: Parameters<typeof trade.addCustomer>[1]) => trade.addCustomer(need(), input),
  findCustomers: (text: string) => trade.findCustomers(need(), text).map((c) => ({ ...c, balancePaise: trade.customerBalance(need(), c.id) })),
  receivePayment: (input: Parameters<typeof trade.receivePayment>[1]) => trade.receivePayment(need(), input),
  addSupplier: (input: Parameters<typeof trade.addSupplier>[1]) => trade.addSupplier(need(), input),
  recordPurchase: (input: Parameters<typeof trade.recordPurchase>[1]) => trade.recordPurchase(need(), input),
  createReturn: (input: Parameters<typeof trade.createReturn>[1]) => trade.createReturn(need(), input),
  importSeed: (data: seed.Seed, userId: string) => seed.importSeed(need(), data, userId),
  config: () => seed.counterConfig(need()),
  setPin: (pin: string) => seed.setPin(need(), pin),
  checkPin: (pin: string) => seed.checkPin(need(), pin),
  saleDetail: (id: string) => reports.saleDetail(need(), id),
  listBills: (iso: string, text?: string) => reports.listBills(need(), iso, text),
  dayReport: (branchId: string, iso?: string) => reports.dayReport(need(), branchId, iso),
  stockList: (branchId: string, text?: string) => reports.stockList(need(), branchId, text),
  updateMedicine: (id: string, patch: Parameters<typeof reports.updateMedicine>[2]) => reports.updateMedicine(need(), id, patch),
  customerList: (text?: string) => reports.customerList(need(), text),
  supplierList: () => reports.supplierList(need()),
  recentSales: (limit?: number) => seed.recentSales(need(), limit),
  counts: () => ({ medicines: need().from("medicine").count(), bills: need().from("sale").count(), pendingChanges: need().pendingChanges(100000).length }),
  setDriveAccess: (a: { token: string; folderId: string; expiresAt: number }) => { access = a; return true; },
  driveStatus: async () => {
    const st = await sync.driveStatus(store());
    return { ...st, unlocked: !!dataKey, pending: db ? db.pendingChanges(100000).length : 0, lastSnapshot: state.lastSnapshot ?? db?.getMeta("lastSnapshot") ?? st.snapshotAt, lastPush: state.lastPush, lastError: state.lastError };
  },
  /** First-time setup. Returns the recovery code to show the owner once. */
  createVault: async () => {
    const r = await sync.createVault(store(), keys, need().device);
    dataKey = r.dataKey;
    await syncNow(true);
    return r.recoveryCode;
  },
  unlock: async (recoveryCode?: string) => { dataKey = await sync.unlock(store(), keys, deviceName, recoveryCode || undefined); void syncNow(); return true; },
  syncNow: (snapshot?: boolean) => syncNow(!!snapshot),
  /** Rebuilds this device's database from Drive (empty device, or after a wipe). */
  restore: async (recoveryCode?: string) => {
    const s = store();
    dataKey = await sync.unlock(s, keys, deviceName, recoveryCode || undefined);
    if (need().from("medicine").withDeleted().count() > 0) throw new Error("This device already has data. Reset it before restoring.");
    const r = await sync.restoreFromDrive(s, dataKey, deviceName, async (bytes) => {
      need().engine.close(); db = null;
      await pool!.importDb(FILE, bytes);
      db = openFile();
      return db;
    });
    return { snapshotAt: r.snapshotAt, applied: r.applied };
  },
  /** Deletes this device's database file (demo reset). */
  /** Deletes the open database file (demo reset) and starts it empty. */
  wipe: async () => {
    need().engine.close(); db = null; dataKey = null;
    (pool as unknown as { unlink(f: string): boolean }).unlink(FILE);
    db = openFile();
    return true;
  },
};
export type DeviceHandlers = typeof handlers;

self.onmessage = async ({ data }: MessageEvent<{ id: number; op: keyof DeviceHandlers; args: unknown[] }>) => {
  const { id, op, args } = data ?? {};
  if (typeof id !== "number" || !Object.prototype.hasOwnProperty.call(handlers, op) || !Array.isArray(args)) return;
  try {
    const result = await (handlers[op] as (...a: unknown[]) => unknown)(...args);
    self.postMessage({ id, ok: true, result });
  } catch (e) {
    self.postMessage({ id, ok: false, error: e instanceof Error ? e.message : String(e), counter: e instanceof pharmacy.CounterError });
  }
};
