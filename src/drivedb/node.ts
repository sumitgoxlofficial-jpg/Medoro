/** Opens an in-memory DriveDB in Node (tests, scripts). The browser opens one in OPFS instead (see public/drivedb). */
import sqlite3InitModule from "@sqlite.org/sqlite-wasm";
import { DriveDB } from "./client";
import { wasmEngine, type WasmDb } from "./engine";

let sqlite: Awaited<ReturnType<typeof sqlite3InitModule>> | null = null;

export async function memoryDb(device = "TEST") {
  sqlite ??= await sqlite3InitModule();
  const engine = wasmEngine(new sqlite.oo1.DB(":memory:") as unknown as WasmDb);
  return DriveDB.open(engine, { device });
}
