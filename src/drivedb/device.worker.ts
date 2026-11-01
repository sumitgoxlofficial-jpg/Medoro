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

type Pool = { OpfsSAHPoolDb: new (file: string) => WasmDb; wipeFiles(): Promise<void> };
let db: DriveDB | null = null;
let pool: Pool | null = null;

async function open(device: string) {
  if (db) return { device: db.device };
  // The SQLite build is copied to /drivedb/sqlite at build time (scripts/copy-sqlite.mjs); load it as-is.
  const url = "/drivedb/sqlite/index.mjs";
  const mod = await import(/* webpackIgnore: true */ url);
  const sqlite = await mod.default();
  pool = (await sqlite.installOpfsSAHPoolVfs({ name: "medoro-device" })) as Pool;
  db = DriveDB.open(wasmEngine(new pool.OpfsSAHPoolDb("/pharmacy.db")), { device });
  return { device: db.device };
}

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
  recentSales: (limit?: number) => seed.recentSales(need(), limit),
  counts: () => ({ medicines: need().from("medicine").count(), bills: need().from("sale").count(), pendingChanges: need().pendingChanges(100000).length }),
  /** Deletes this device's database file (demo reset). */
  wipe: async () => { need().engine.close(); db = null; await pool?.wipeFiles(); return true; },
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
