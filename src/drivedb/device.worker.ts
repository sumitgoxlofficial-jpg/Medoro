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
import * as books from "./books";
import * as ops from "./ops";
import * as sync from "./sync";
import * as move from "./migrate-in";
import type { MoveBase, MovePart } from "@/domain/system/drive-move";
import type { DriveStore } from "./drive";
import { relayInbox, relayStore, registerDevice, reportHealth, RelayRefusedError } from "./relay";
import * as inbox from "./inbox";
import type { DeviceKeys, Keyring } from "./keyring";
import { WrongKeyError } from "./crypto";

type Pool = { OpfsSAHPoolDb: new (file: string) => WasmDb; wipeFiles(): Promise<void>; importDb(name: string, bytes: Uint8Array): Promise<number> | number };
type Sqlite = { capi: { sqlite3_js_db_export(db: WasmDb): Uint8Array }; installOpfsSAHPoolVfs(o: { name: string }): Promise<Pool> };
/** The pharmacy's database file; the device test page's demo uses its own file so sample data never mixes in. */
const FILES = { pharmacy: "/pharmacy.db", demo: "/demo.db" } as const;
let FILE: string = FILES.pharmacy;
let db: DriveDB | null = null;
let pool: Pool | null = null;
let sqlite: Sqlite | null = null;
let deviceName = "";
/** Resolves once a database is open (Drive calls wait for it, so they know this device's id). */
let markOpen: () => void = () => {};
const opened = new Promise<void>((r) => { markOpen = r; });

const openFile = () => DriveDB.open(wasmEngine(new pool!.OpfsSAHPoolDb(FILE), (d) => sqlite!.capi.sqlite3_js_db_export(d)), { device: deviceName });

async function open(device: string, which: keyof typeof FILES = "pharmacy") {
  if (!Object.prototype.hasOwnProperty.call(FILES, which)) throw new Error("Unknown database.");
  if (db && FILE === FILES[which]) return { device: db.device };
  if (db) { db.engine.close(); db = null; ring = null; }
  FILE = FILES[which];
  // The SQLite build is copied to /drivedb/sqlite at build time (scripts/copy-sqlite.mjs); load it as-is.
  const url = "/drivedb/sqlite/index.mjs";
  const mod = await import(/* webpackIgnore: true */ url);
  sqlite ??= (await mod.default()) as Sqlite;
  pool ??= await sqlite.installOpfsSAHPoolVfs({ name: "medoro-device" });
  deviceName = device;
  db = openFile();
  markOpen();
  return { device: db.device };
}

// ---------- Google Drive, through Medoro's relay (phases 2 and 4) ----------

/** This device's key pair, kept in the browser's IndexedDB (the private key can't be read out, only used). */
const keys: sync.KeyStore = {
  get: () => idb<DeviceKeys | null>("readonly", (s) => s.get("device-v2")).then((k) => k ?? null),
  set: (k) => idb("readwrite", (s) => s.put(k, "device-v2")).then(() => undefined),
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

type Access = { status: "approved" | "pending" | "removed"; role: "owner" | "staff" };
let access: Access | null = null;
let ring: Keyring | null = null;
const state = { lastPush: null as string | null, lastPull: null as string | null, lastSnapshot: null as string | null, lastError: null as string | null, needsRestore: false, busy: false };
const store = (): DriveStore => relayStore(deviceName);
const SNAPSHOT_EVERY = 6 * 3600_000;

/** Upload this device's changes, apply everyone else's, and (owner devices) save a full copy now and then. */
async function syncNow(forceSnapshot = false) {
  if (!db || !ring || access?.status !== "approved" || state.busy) return state;
  state.busy = true;
  try {
    const last = db.getMeta("lastSnapshot");
    if (ring.rk && (forceSnapshot || !last || Date.now() - Date.parse(last) > SNAPSHOT_EVERY)) {
      const m = await sync.writeSnapshot(db, store(), ring, () => need().engine.exportBytes());
      state.lastSnapshot = m.snapshotAt;
    } else {
      while (await sync.pushChanges(db, store(), ring)) { /* until empty */ }
      try { await sync.pullChanges(db, store(), ring); }
      catch (e) {
        // A newer key (a device was removed): re-read the keys once and try again.
        if (!(e instanceof WrongKeyError)) throw e;
        const fresh = await sync.refreshKeys(store(), keys, deviceName);
        if (!fresh) throw new RelayRefusedError("This device no longer has the pharmacy’s key. Ask the owner to approve it again.");
        ring = fresh;
        await sync.pullChanges(db, store(), ring);
      }
      state.lastPull = new Date().toISOString();
    }
    state.lastPush = new Date().toISOString();
    state.lastError = null; state.needsRestore = false;
  } catch (e) {
    if (e instanceof sync.NeedsRestoreError) state.needsRestore = true;
    if (e instanceof RelayRefusedError && /removed/i.test(e.message)) { access = { ...(access ?? { role: "staff" }), status: "removed" }; ring = null; }
    state.lastError = e instanceof Error ? e.message : String(e);
  } finally { state.busy = false; }
  void report();
  void pickUpPayments();
  return state;
}

/** Customer payments that arrived while no counter was online: record them as receipts, then Medoro deletes them. */
let lastPickUp = 0;
async function pickUpPayments() {
  if (!db || access?.status !== "approved" || Date.now() - lastPickUp < 30_000) return;
  lastPickUp = Date.now();
  try {
    const box = relayInbox(deviceName);
    const waiting = await box.list();
    if (!waiting.length) return;
    const mine = await keys.get();
    if (!mine) return;
    const opened: inbox.InboxPayment[] = [];
    for (const w of waiting) { try { opened.push(await inbox.openForDevice(mine.privateKey, w.sealed)); } catch { /* sealed for an older key of this device */ } }
    await box.ack(inbox.applyPayments(db, opened));
  } catch { /* offline: next time */ }
}

/** Sends the sync result to Medoro when it changes, and a "still fine" at most every 10 minutes. */
let reported: { error: string | null; at: number } | null = null;
async function report() {
  if (access?.status !== "approved") return;
  const error = state.lastError;
  if (reported && reported.error === error && (error || Date.now() - reported.at < 10 * 60_000)) return;
  reported = { error, at: Date.now() };
  await reportHealth(deviceName, error);
}
setInterval(() => { void syncNow(); }, 5_000);

/** Registers this device (its public key) with the relay and opens the keys if it can. */
async function connect(name: string) {
  await opened;
  const mine = await sync.deviceKeys(keys);
  access = await registerDevice(deviceName, name, mine.publicJwk);
  if (access.status === "approved" && !ring) ring = await sync.refreshKeys(store(), keys, deviceName).catch(() => null);
  return access;
}

let moving: MoveBase | null = null;
const need = () => { if (!db) throw new Error("The device database isn’t open."); return db; };

const handlers = {
  open,
  addMedicine: (input: pharmacy.MedicineInput) => pharmacy.addMedicine(need(), input),
  receiveStock: (input: Parameters<typeof pharmacy.receiveStock>[1]) => pharmacy.receiveStock(need(), input),
  search: (text: string, branchId: string) => pharmacy.searchMedicines(need(), text).map((m) => ({ ...m, stock: pharmacy.stockOf(need(), m.id, branchId) })),
  createSale: (input: pharmacy.SaleInput) => pharmacy.createSale(need(), input),
  dayTotals: (branchId: string, iso: string) => pharmacy.dayTotals(need(), branchId, iso),
  addCustomer: (input: Parameters<typeof trade.addCustomer>[1]) => trade.addCustomer(need(), input),
  findCustomers: (text: string) => trade.findCustomers(need(), text).map((c) => ({ ...c, balancePaise: trade.customerBalance(need(), c.id), points: pharmacy.pointsBalance(need(), c.id) })),
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
  supplierDues: () => books.supplierDues(need()),
  supplierLedger: (id: string) => books.supplierLedger(need(), id),
  paySupplier: (input: Parameters<typeof books.paySupplier>[1]) => books.paySupplier(need(), input),
  addExpense: (input: Parameters<typeof books.addExpense>[1]) => books.addExpense(need(), input),
  expenses: (branchId: string, from: string, to: string) => books.expenses(need(), branchId, from, to),
  cashBook: (branchId: string, iso?: string) => books.cashBook(need(), branchId, iso),
  salesByDay: (branchId: string, from: string, to: string) => books.salesByDay(need(), branchId, from, to),
  topMedicines: (branchId: string, from: string, to: string) => books.topMedicines(need(), branchId, from, to),
  expiringStock: (branchId: string, days?: number) => books.expiringStock(need(), branchId, days),
  gstReturns: (month: string, gstin: string) => books.gstReturns(need(), month, gstin),
  batchesFor: (medicineId: string, branchId: string) => ops.batchesFor(need(), medicineId, branchId),
  adjustStock: (input: Parameters<typeof ops.adjustStock>[1]) => ops.adjustStock(need(), input),
  recordCount: (input: Parameters<typeof ops.recordCount>[1]) => ops.recordCount(need(), input),
  setBatchStatus: (batchId: string, status: "ok" | "quarantine" | "recalled") => ops.setBatchStatus(need(), batchId, status),
  createOrder: (input: Parameters<typeof ops.createOrder>[1]) => ops.createOrder(need(), input),
  packOrder: (input: Parameters<typeof ops.packOrder>[1]) => ops.packOrder(need(), input),
  dispatchOrder: (id: string, rider: string) => ops.dispatchOrder(need(), id, rider),
  deliverOrder: (id: string, userId: string) => ops.deliverOrder(need(), id, userId),
  cancelOrder: (id: string) => ops.cancelOrder(need(), id),
  listOrders: (branchId: string, showDone?: boolean) => ops.listOrders(need(), branchId, showDone),
  transferStock: (input: Parameters<typeof ops.transferStock>[1]) => ops.transferStock(need(), input),
  activityLog: (opts?: { limit?: number; text?: string }) => reports.activityLog(need(), opts),
  recentSales: (limit?: number) => seed.recentSales(need(), limit),
  counts: () => ({ medicines: need().from("medicine").count(), bills: need().from("sale").count(), pendingChanges: need().pendingChanges(100000).length }),
  /** Joins Drive sync: registers this device and opens its keys. Returns approved / pending / removed. */
  connect,
  driveStatus: async () => {
    const st = access?.status === "approved" ? await sync.driveStatus(store()) : { vault: false, snapshotAt: null, snapshotBytes: 0 };
    return {
      ...st, access, unlocked: !!ring, owner: !!ring?.rk, pending: db ? db.pendingChanges(100000).length : 0,
      lastSnapshot: state.lastSnapshot ?? db?.getMeta("lastSnapshot") ?? st.snapshotAt, lastPush: state.lastPush, lastPull: state.lastPull,
      lastError: state.lastError, needsRestore: state.needsRestore,
    };
  },
  /** First-time setup (owner's device). Returns the recovery code to show once. */
  createVault: async () => {
    const r = await sync.createVault(store(), keys, need().device);
    ring = r.ring;
    await syncNow(true);
    return r.recoveryCode;
  },
  unlock: async (recoveryCode?: string) => { ring = await sync.unlock(store(), keys, deviceName, recoveryCode || undefined); void syncNow(); return true; },
  syncNow: (snapshot?: boolean) => syncNow(!!snapshot),
  /** Owner's device gives a waiting device the keys (then the server marks it approved). */
  approveDevice: async (deviceId: string, publicJwk: JsonWebKey, role: "owner" | "staff", name: string) => {
    if (!ring?.rk) throw new Error("Unlock Drive storage on this device first.");
    await sync.approveDevice(store(), ring, deviceId, publicJwk, role, name);
    return true;
  },
  /** Owner's device removes a device: new changes use a new key it never gets. */
  revokeDevice: async (deviceId: string) => {
    if (!ring?.rk) throw new Error("Unlock Drive storage on this device first.");
    while (db && (await sync.pushChanges(db, store(), ring))) { /* old key for old changes */ }
    ring = await sync.revokeDevice(store(), ring, deviceId);
    return true;
  },
  /** Rebuilds this device's database from Drive (new device, after a wipe, or when it fell too far behind). */
  restore: async (recoveryCode?: string) => {
    const s = store();
    ring = await sync.unlock(s, keys, deviceName, recoveryCode || undefined);
    const hasData = need().from("medicine").withDeleted().count() > 0;
    if (hasData && !state.needsRestore) throw new Error("This device already has data. Reset it before restoring.");
    if (hasData) while (await sync.pushChanges(need(), s, ring)) { /* keep this device's unsent bills */ }
    const keepPin = need().getMeta("pinHash");
    const r = await sync.restoreFromDrive(s, ring, deviceName, async (bytes) => {
      need().engine.close(); db = null;
      await pool!.importDb(FILE, bytes);
      db = openFile();
      return db;
    });
    if (keepPin) need().setMeta("pinHash", keepPin);
    state.needsRestore = false; state.lastError = null;
    return { snapshotAt: r.snapshotAt, applied: r.applied };
  },
  /** Phase 7: loads the pharmacy's data from Medoro (an unfinished earlier attempt is cleared first). */
  moveBegin: async (base: MoveBase) => {
    if (move.moveInProgress(need())) await handlers.wipe();
    move.beginMove(need(), base);
    moving = base;
    return true;
  },
  movePart: (part: Exclude<MovePart, "base">, rows: unknown[]) => move.importPart(need(), part, rows),
  /** Checks the loaded data against Medoro's totals; when all match, this device becomes a counter. */
  moveFinish: (userId: string) => {
    if (!moving) throw new Error("Start the move again.");
    const r = move.finishMove(need(), moving, userId);
    if (r.ok) moving = null;
    return r;
  },
  /** Deletes the open database file (demo reset) and starts it empty. */
  wipe: async () => {
    need().engine.close(); db = null; ring = null;
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
