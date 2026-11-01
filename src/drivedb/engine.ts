/**
 * The smallest SQL surface DriveDB needs, so the same code runs on SQLite WebAssembly in the browser
 * (a worker, OPFS storage) and in Node for tests. Calls are synchronous: SQLite runs in-process.
 */
export type SqlValue = string | number | null | bigint | Uint8Array;
export type Row = Record<string, SqlValue>;

export interface SqlEngine {
  run(sql: string, params?: SqlValue[]): void;
  all<T extends Row = Row>(sql: string, params?: SqlValue[]): T[];
  /** Runs `fn` atomically. Nested calls use savepoints, so an inner failure rolls back only its own work. */
  tx<T>(fn: () => T): T;
  close(): void;
  /** The whole database as one file (for snapshots). */
  exportBytes(): Uint8Array;
}

/** The parts of a sqlite-wasm `oo1.DB` we use. */
export type WasmDb = {
  exec(opts: { sql: string; bind?: SqlValue[]; rowMode?: "object"; returnValue?: "resultRows" }): unknown;
  close(): void;
};

/** `exportDb` is sqlite3.capi.sqlite3_js_db_export, bound by the caller (it needs the loaded module). */
export function wasmEngine(db: WasmDb, exportDb?: (db: WasmDb) => Uint8Array): SqlEngine {
  let depth = 0;
  const run = (sql: string, params: SqlValue[] = []) => { db.exec({ sql, bind: params.length ? params : undefined }); };
  return {
    run,
    all: <T extends Row>(sql: string, params: SqlValue[] = []) =>
      db.exec({ sql, bind: params.length ? params : undefined, rowMode: "object", returnValue: "resultRows" }) as T[],
    tx<T>(fn: () => T): T {
      const sp = `sp${depth}`;
      run(depth === 0 ? "BEGIN IMMEDIATE" : `SAVEPOINT ${sp}`);
      depth++;
      try {
        const r = fn();
        depth--;
        run(depth === 0 ? "COMMIT" : `RELEASE ${sp}`);
        return r;
      } catch (e) {
        depth--;
        run(depth === 0 ? "ROLLBACK" : `ROLLBACK TO ${sp}; RELEASE ${sp}`);
        throw e;
      }
    },
    close: () => db.close(),
    exportBytes: () => {
      if (!exportDb) throw new Error("This database can’t be exported.");
      return exportDb(db);
    },
  };
}
