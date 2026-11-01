/** Opens an in-memory DriveDB in Node (tests, scripts). The browser opens one in OPFS instead (see device.worker.ts). */
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import { DriveDB } from "./client";
import { wasmEngine, type WasmDb } from "./engine";

type Sqlite = Awaited<ReturnType<typeof sqlite3InitModule>>;
let sqlite: Sqlite | null = null;
const load = async () => (sqlite ??= await sqlite3InitModule());
const exporter = (s: Sqlite) => (db: WasmDb) => s.capi.sqlite3_js_db_export(db as never);

export async function memoryDb(device = "TEST") {
  const s = await load();
  return DriveDB.open(wasmEngine(new s.oo1.DB(":memory:") as unknown as WasmDb, exporter(s)), { device });
}

/** Opens a database file's bytes (e.g. a snapshot) as an in-memory DriveDB. */
export async function memoryDbFrom(bytes: Uint8Array, device = "TEST") {
  const s = await load();
  const raw = new s.oo1.DB(":memory:");
  const p = s.wasm.allocFromTypedArray(bytes);
  const rc = s.capi.sqlite3_deserialize(raw.pointer!, "main", p, bytes.length, bytes.length, s.capi.SQLITE_DESERIALIZE_FREEONCLOSE | s.capi.SQLITE_DESERIALIZE_RESIZEABLE);
  raw.checkRc(rc);
  return DriveDB.open(wasmEngine(raw as unknown as WasmDb, exporter(s)), { device });
}
