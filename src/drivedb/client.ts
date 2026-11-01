/**
 * DriveDB: the pharmacy database on the device, with a small Supabase-style API.
 *
 *   const db = DriveDB.open(engine, { device: "C1" });
 *   db.from("medicine").select("id,name").ilike("name", "para%").order("name").limit(20).all();
 *   db.from("medicine").insert({ name: "Dolo 650", gstRate: 12, mrpPaise: 3200 });
 *   db.transaction(() => { ... });
 *
 * Every write also appends a change record (changeLog) in the same transaction, stamped with this
 * device's clock, so nothing can be saved without being synced. Table and column names are checked
 * against the schema; values always go in as bound parameters.
 */
import { Clock } from "./hlc";
import { MIGRATIONS, SCHEMA_VERSION, TABLES, isTable, type TableName } from "./schema";
import type { Row, SqlEngine, SqlValue } from "./engine";

export class DriveDBError extends Error {}

type Input = Record<string, SqlValue | boolean | undefined>;
export type Change = { seq: number; id: string; clock: string; tbl: TableName; rowId: string; op: "insert" | "update" | "delete"; data: Row };

const uuid = () => globalThis.crypto.randomUUID();
const nowIso = () => new Date().toISOString();

/** Brings the database file up to the current schema. Refuses a file made by a newer app version. */
export function migrate(e: SqlEngine) {
  const v = Number(e.all<{ user_version: number }>("PRAGMA user_version")[0]?.user_version ?? 0);
  if (v > SCHEMA_VERSION) throw new DriveDBError(`This pharmacy file was saved by a newer version of Medoro (v${v}). Update the app to open it.`);
  for (let i = v; i < SCHEMA_VERSION; i++) {
    e.tx(() => {
      e.run(MIGRATIONS[i]);
      e.run(`PRAGMA user_version = ${i + 1}`);
    });
  }
}

export class DriveDB {
  readonly clock: Clock;

  private constructor(readonly engine: SqlEngine, device: string) {
    const last = engine.all<{ value: string }>("SELECT value FROM meta WHERE key = 'clock'")[0]?.value ?? null;
    this.clock = new Clock(device, last);
  }

  /** Opens (and migrates) a pharmacy database for this device. */
  static open(engine: SqlEngine, opts: { device: string }) {
    engine.run("PRAGMA foreign_keys = ON");
    migrate(engine);
    return new DriveDB(engine, opts.device);
  }

  get device() { return this.clock.device; }

  from<T extends Row = Row>(table: TableName) {
    if (!isTable(table)) throw new DriveDBError(`Unknown table ${String(table)}`);
    return new Query<T>(this, table);
  }

  /** All-or-nothing: if `fn` throws, none of its writes (or their change records) are kept. */
  transaction<T>(fn: () => T): T { return this.engine.tx(fn); }

  /** Local changes not yet uploaded, oldest first. */
  pendingChanges(limit = 500): Change[] {
    return this.engine.all<Row>("SELECT seq, id, clock, tbl, rowId, op, data FROM changeLog WHERE pushed = 0 ORDER BY seq LIMIT ?", [limit])
      .map((r) => ({ ...r, data: JSON.parse(String(r.data)) }) as Change);
  }

  markPushed(uptoSeq: number) { this.engine.run("UPDATE changeLog SET pushed = 1 WHERE pushed = 0 AND seq <= ?", [uptoSeq]); }

  /** A local setting of this device (not synced). */
  getMeta(key: string): string | null {
    return this.engine.all<{ value: string }>("SELECT value FROM meta WHERE key = ?", [`cfg:${key}`])[0]?.value ?? null;
  }
  setMeta(key: string, value: string) {
    this.engine.run("INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [`cfg:${key}`, value]);
  }

  /** Next number in a per-device counter, e.g. this counter's invoice series for the year. */
  nextSeq(name: string): number {
    return this.engine.tx(() => {
      const n = Number(this.engine.all<{ next: number }>("SELECT next FROM sequence WHERE name = ?", [name])[0]?.next ?? 1);
      this.engine.run("INSERT INTO sequence (name, next) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET next = excluded.next", [name, n + 1]);
      return n;
    });
  }

  /** @internal A new clock stamp for a local change (remembered across restarts). Call inside a transaction. */
  stamp(): string {
    const clock = this.clock.tick();
    this.engine.run("INSERT INTO meta (key, value) VALUES ('clock', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", [clock]);
    return clock;
  }

  /** @internal Records a change for sync. Call inside the same transaction as the write. */
  record(clock: string, tbl: TableName, rowId: string, op: Change["op"], data: Row) {
    this.engine.run("INSERT INTO changeLog (id, clock, tbl, rowId, op, data) VALUES (?, ?, ?, ?, ?, ?)", [clock, clock, tbl, rowId, op, JSON.stringify(data)]);
  }
}

type Cond = { sql: string; params: SqlValue[] };

/** A query on one table. Reads end with all(), first() or count(); writes run immediately. */
export class Query<T extends Row> {
  private cols = "*";
  private conds: Cond[] = [];
  private orders: string[] = [];
  private lim: number | null = null;
  private off = 0;
  private deleted = false;
  private readonly spec;

  constructor(private readonly db: DriveDB, readonly table: TableName) { this.spec = TABLES[table]; }

  private col(c: string) {
    if (!(this.spec.columns as readonly string[]).includes(c)) throw new DriveDBError(`${this.table} has no column ${c}`);
    return c;
  }
  private where(sql: string, ...params: SqlValue[]) { this.conds.push({ sql, params }); return this; }

  select(cols = "*") {
    this.cols = cols.trim() === "*" ? "*" : cols.split(",").map((c) => this.col(c.trim())).join(", ");
    return this;
  }
  eq(c: string, v: SqlValue | boolean) { return this.where(`${this.col(c)} = ?`, val(v)); }
  neq(c: string, v: SqlValue | boolean) { return this.where(`${this.col(c)} IS NOT ?`, val(v)); }
  gt(c: string, v: SqlValue) { return this.where(`${this.col(c)} > ?`, v); }
  gte(c: string, v: SqlValue) { return this.where(`${this.col(c)} >= ?`, v); }
  lt(c: string, v: SqlValue) { return this.where(`${this.col(c)} < ?`, v); }
  lte(c: string, v: SqlValue) { return this.where(`${this.col(c)} <= ?`, v); }
  /** Case-insensitive pattern: % any run, _ one character. */
  ilike(c: string, pattern: string) { return this.where(`${this.col(c)} LIKE ?`, pattern); }
  /** Case-sensitive pattern: % any run, _ one character. */
  like(c: string, pattern: string) {
    const glob = pattern.replace(/[*?[\]]/g, "[$&]").replace(/%/g, "*").replace(/_/g, "?");
    return this.where(`${this.col(c)} GLOB ?`, glob);
  }
  in(c: string, vs: (SqlValue | boolean)[]) {
    if (!vs.length) return this.where("0");
    return this.where(`${this.col(c)} IN (${vs.map(() => "?").join(", ")})`, ...vs.map(val));
  }
  is(c: string, v: null | boolean) { return v === null ? this.where(`${this.col(c)} IS NULL`) : this.eq(c, v); }
  order(c: string, opts: { ascending?: boolean } = {}) { this.orders.push(`${this.col(c)} ${opts.ascending === false ? "DESC" : "ASC"}`); return this; }
  limit(n: number) { this.lim = Math.max(0, Math.floor(n)); return this; }
  /** Rows from..to inclusive, counting from 0 (like Supabase). */
  range(from: number, to: number) { this.off = Math.max(0, Math.floor(from)); this.lim = Math.max(0, Math.floor(to) - this.off + 1); return this; }
  /** Include soft-deleted rows. */
  withDeleted() { this.deleted = true; return this; }

  private whereSql() {
    const cs = [...this.conds];
    if (this.spec.kind === "mutable" && !this.deleted) cs.push({ sql: "deletedAt IS NULL", params: [] });
    return { sql: cs.length ? ` WHERE ${cs.map((c) => `(${c.sql})`).join(" AND ")}` : "", params: cs.flatMap((c) => c.params) };
  }

  all(): T[] {
    const w = this.whereSql();
    let sql = `SELECT ${this.cols} FROM ${this.table}${w.sql}`;
    if (this.orders.length) sql += ` ORDER BY ${this.orders.join(", ")}`;
    if (this.lim !== null || this.off) sql += ` LIMIT ${this.lim ?? -1} OFFSET ${this.off}`;
    return this.db.engine.all<T>(sql, w.params);
  }
  first(): T | null { this.lim = 1; return this.all()[0] ?? null; }
  count(): number {
    const w = this.whereSql();
    return Number(this.db.engine.all<{ n: number }>(`SELECT COUNT(*) AS n FROM ${this.table}${w.sql}`, w.params)[0].n);
  }

  // ---- writes ----

  private clean(input: Input, forInsert: boolean): Row {
    const out: Row = {};
    for (const [k, v] of Object.entries(input)) {
      if (v === undefined) continue;
      if (k === "updatedAt" || k === "deletedAt") throw new DriveDBError(`${k} is set by DriveDB`);
      if (!forInsert && k === "id") throw new DriveDBError("A row's id can't change");
      out[this.col(k)] = val(v);
    }
    return out;
  }

  /** Adds rows. Missing ids are generated. Returns the rows as stored. */
  insert(rows: Input | Input[]): T[] {
    const list = Array.isArray(rows) ? rows : [rows];
    return this.db.transaction(() => list.map((input) => {
      const row = this.clean(input, true);
      if (row.id == null) row.id = uuid();
      const stamp = this.db.stamp();
      if (this.spec.kind === "mutable") { row.updatedAt = stamp; row.deletedAt = null; }
      this.db.record(stamp, this.table, String(row.id), "insert", row);
      const keys = Object.keys(row);
      this.db.engine.run(`INSERT INTO ${this.table} (${keys.join(", ")}) VALUES (${keys.map(() => "?").join(", ")})`, keys.map((k) => row[k]));
      return row as T;
    }));
  }

  private requireMutable(what: string) {
    if (this.spec.kind !== "mutable") throw new DriveDBError(`${this.table} records can't be ${what}: add a correcting record instead`);
  }

  /** Changes the matching rows. Returns their ids. */
  update(patch: Input): string[] {
    this.requireMutable("changed");
    const p = this.clean(patch, false);
    const keys = Object.keys(p);
    if (!keys.length) return [];
    return this.db.transaction(() => {
      const ids = this.matchingIds();
      for (const id of ids) {
        const stamp = this.db.stamp();
        this.db.record(stamp, this.table, id, "update", p);
        this.db.engine.run(`UPDATE ${this.table} SET ${keys.map((k) => `${k} = ?`).join(", ")}, updatedAt = ? WHERE id = ?`, [...keys.map((k) => p[k]), stamp, id]);
      }
      return ids;
    });
  }

  /** Soft-deletes the matching rows (they stay for history and sync). Returns their ids. */
  delete(): string[] {
    this.requireMutable("deleted");
    return this.db.transaction(() => {
      const ids = this.matchingIds();
      const at = nowIso();
      for (const id of ids) {
        const stamp = this.db.stamp();
        this.db.record(stamp, this.table, id, "delete", { deletedAt: at });
        this.db.engine.run(`UPDATE ${this.table} SET deletedAt = ?, updatedAt = ? WHERE id = ?`, [at, stamp, id]);
      }
      return ids;
    });
  }

  /** Inserts the row, or updates it if a row with its id exists. */
  upsert(input: Input & { id: string }): T {
    this.requireMutable("changed");
    return this.db.transaction(() => {
      const exists = this.db.engine.all(`SELECT 1 FROM ${this.table} WHERE id = ?`, [input.id]).length > 0;
      if (!exists) return this.insert(input)[0];
      const { id, ...rest } = input;
      new Query<T>(this.db, this.table).withDeleted().eq("id", id).update(rest);
      return this.db.engine.all<T>(`SELECT * FROM ${this.table} WHERE id = ?`, [id])[0];
    });
  }

  private matchingIds(): string[] {
    const w = this.whereSql();
    return this.db.engine.all<{ id: string }>(`SELECT id FROM ${this.table}${w.sql}`, w.params).map((r) => String(r.id));
  }
}

const val = (v: SqlValue | boolean): SqlValue => (typeof v === "boolean" ? (v ? 1 : 0) : v);
