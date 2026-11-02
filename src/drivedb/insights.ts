/**
 * Stock intelligence on the counter (Drive mode): the same insights as Medoro's web screen (/app/intelligence),
 * worked out from this device's own records. Demand forecast and reorder suggestions, seasonal pre-stock, supplier
 * price comparison, slow and dead stock, audit anomalies and margins.
 *
 * Every figure comes from a few grouped SQL queries (no query per medicine), so a catalogue of ~20k medicines with a
 * year of bills stays quick. Quantities are packs, money is integer paise, as on the server.
 *
 * Differences from the web, because the counter has no such records: suppliers carry no lead time (1 day is used,
 * the server's default), there are no shift cash counts or sign-in logs (those two anomaly rules are replaced by
 * bills made at night), and there are no purchase orders: suggestions become a draft order list to print, export
 * or send on WhatsApp. Settings, reviewed anomalies and the draft are this device's own (meta, not synced).
 */
import { z } from "zod";
import type { DriveDB } from "./client";
import { CounterError } from "./pharmacy";
import type { Pharmacy } from "./seed";
import { monthCoverage, seasonalLine } from "@/domain/intelligence/seasonal";
import { exGst, marginPct } from "@/domain/purchasing/pricing";
import { stockValue } from "@/lib/units";
import { addDays, istMidnight, todayISO } from "@/lib/dates";

const n = (v: unknown) => Number(v ?? 0);
const DAY = 86400_000, IST = 330 * 60000;

/**
 * Rows of a query, read as one JSON text: on SQLite WebAssembly this is several times quicker than one JS object per
 * row, which matters for the 20k-row reads here. `cols` are the query's column names, in order.
 */
function many<T>(db: DriveDB, sql: string, params: (string | number)[], cols: readonly string[]): T[] {
  const j = db.engine.all<{ j: string | null }>(`SELECT json_group_array(json_array(${cols.map((c) => `q."${c}"`).join(", ")})) AS j FROM (${sql}) q`, params)[0]?.j;
  return (JSON.parse(j ?? "[]") as unknown[][]).map((a) => Object.fromEntries(cols.map((c, i) => [c, a[i]])) as T);
}

// ---------- settings (this device) ----------

export const COVERS = [7, 14, 21, 30] as const;
export const SAFETIES = [1, 2, 3, 5] as const;
export type Policy = { cover: number; safety: number };
export type Thresholds = { disc: number; refunds: number };
export type IntelSettings = { policy: Policy; anomaly: Thresholds };
export const INTEL_DEFAULTS: IntelSettings = { policy: { cover: 21, safety: 2 }, anomaly: { disc: 5, refunds: 2 } };

const policyInput = z.object({
  cover: z.number().refine((v) => (COVERS as readonly number[]).includes(v), "Invalid policy."),
  safety: z.number().refine((v) => (SAFETIES as readonly number[]).includes(v), "Invalid policy."),
});
const thresholdInput = z.object({ disc: z.number().int("Invalid threshold.").min(0, "Invalid threshold.").max(100, "Invalid threshold."), refunds: z.number().int("Invalid threshold.").min(0, "Invalid threshold.").max(1000, "Invalid threshold.") });

function parseMeta<T>(db: DriveDB, key: string, fallback: T): T {
  try { const raw = db.getMeta(key); return raw ? { ...fallback, ...(JSON.parse(raw) as Partial<T>) } : fallback; } catch { return fallback; }
}
export const intelSettings = (db: DriveDB): IntelSettings => ({
  policy: parseMeta(db, "intel:policy", INTEL_DEFAULTS.policy), anomaly: parseMeta(db, "intel:anomaly", INTEL_DEFAULTS.anomaly),
});
export function saveIntelSettings(db: DriveDB, patch: Partial<IntelSettings>) {
  const check = <T,>(schema: z.ZodType<T>, v: unknown): T => {
    const r = schema.safeParse(v);
    if (!r.success) throw new CounterError(r.error.issues[0]?.message ?? "Invalid setting.");
    return r.data;
  };
  if (patch.policy) db.setMeta("intel:policy", JSON.stringify(check(policyInput, patch.policy)));
  if (patch.anomaly) db.setMeta("intel:anomaly", JSON.stringify(check(thresholdInput, patch.anomaly)));
  return intelSettings(db);
}

// ---------- shared aggregates ----------

/**
 * Running totals in TEMP tables (this connection only: never saved, synced or uploaded). Stock movements and bill
 * lines are only ever added, so each read adds just the rows past the last one counted, instead of summing a year
 * of records every time the screen opens. If the table shrank (a different file opened), they start over.
 */
function catchUp(db: DriveDB, name: "mv" | "si" | "pi") {
  const e = db.engine;
  e.run("CREATE TEMP TABLE IF NOT EXISTS intel_mark (name TEXT PRIMARY KEY, upto INTEGER NOT NULL)");
  e.run("CREATE TEMP TABLE IF NOT EXISTS intel_bq (batchId TEXT PRIMARY KEY, q INTEGER NOT NULL, since TEXT NOT NULL)");
  e.run("CREATE TEMP TABLE IF NOT EXISTS intel_lc (batchId TEXT PRIMARY KEY, paid INTEGER NOT NULL, got INTEGER NOT NULL, supplierId TEXT)");
  e.run("CREATE TEMP TABLE IF NOT EXISTS intel_mq (branchId TEXT NOT NULL, ym TEXT NOT NULL, medicineId TEXT NOT NULL, q REAL NOT NULL, PRIMARY KEY (branchId, medicineId, ym))");
  const tbl = { mv: "stockMovement", si: "saleItem", pi: "purchaseItem" }[name], cache = { mv: "intel_bq", si: "intel_mq", pi: "intel_lc" }[name];
  const upto = n(e.all<{ upto: number }>("SELECT upto FROM intel_mark WHERE name = ?", [name])[0]?.upto);
  const max = n(e.all<{ m: number }>(`SELECT COALESCE(MAX(rowid), 0) AS m FROM ${tbl}`)[0].m);
  if (max === upto) return;
  e.tx(() => {
    const from = max < upto ? 0 : upto;
    if (max < upto) e.run(`DELETE FROM ${cache}`);
    if (name === "mv") e.run(
      `INSERT INTO intel_bq (batchId, q, since) SELECT batchId, SUM(qty), MIN(at) FROM stockMovement WHERE rowid > ? AND rowid <= ? GROUP BY batchId
        ON CONFLICT(batchId) DO UPDATE SET q = q + excluded.q, since = MIN(since, excluded.since)`, [from, max]);
    else if (name === "pi") e.run(
      `INSERT INTO intel_lc (batchId, paid, got, supplierId)
         SELECT pi.batchId, SUM(pi.packs), SUM(pi.packs + pi.freePacks), MIN(p.supplierId) FROM purchaseItem pi JOIN purchase p ON p.id = pi.purchaseId
          WHERE pi.rowid > ? AND pi.rowid <= ? GROUP BY pi.batchId
        ON CONFLICT(batchId) DO UPDATE SET paid = paid + excluded.paid, got = got + excluded.got, supplierId = COALESCE(supplierId, excluded.supplierId)`, [from, max]);
    else e.run(
      `INSERT INTO intel_mq (branchId, ym, medicineId, q)
         SELECT s.branchId, strftime('%Y-%m', s.at, '+330 minutes'), si.medicineId, SUM(si.qty * 1.0 / CASE WHEN si.loose THEN si.packSize ELSE 1 END)
           FROM saleItem si JOIN sale s ON s.id = si.saleId WHERE si.rowid > ? AND si.rowid <= ? GROUP BY 1, 2, 3
        ON CONFLICT(branchId, medicineId, ym) DO UPDATE SET q = q + excluded.q`, [from, max]);
    e.run("INSERT INTO intel_mark (name, upto) VALUES (?, ?) ON CONFLICT(name) DO UPDATE SET upto = excluded.upto", [name, max]);
  });
}

/** A batch in stock (units above zero), with its landed cost per pack and when stock first came in. */
export type BatchRow = { id: string; branchId: string; medicineId: string; name: string; ps: number; gst: number; status: string; expiryDate: string; mrp: number; cost: number; q: number; since: string };

/**
 * Every batch with stock, of one branch or (null) all. Landed cost: the bill's rate with free packs spread over the
 * paid ones. The screen reads this once and shares it.
 */
export function batchStock(db: DriveDB, branchId: string | null): BatchRow[] {
  catchUp(db, "mv"); catchUp(db, "pi");
  return many<BatchRow>(db,
    `SELECT b.id, b.branchId, b.medicineId, TRIM(md.name || ' ' || md.strength) AS name, md.packSize AS ps, md.gstRate AS gst, b.status, b.expiryDate, b.mrpPaise AS mrp,
            COALESCE(ROUND(b.costPaise * lc.paid * 1.0 / lc.got), b.costPaise) AS cost, x.q, x.since
       FROM temp.intel_bq x JOIN batch b ON b.id = x.batchId JOIN medicine md ON md.id = b.medicineId
       LEFT JOIN temp.intel_lc lc ON lc.batchId = b.id
      WHERE x.q > 0 AND b.deletedAt IS NULL ${branchId === null ? "" : "AND b.branchId = ?"}`, branchId === null ? [] : [branchId],
    ["id", "branchId", "medicineId", "name", "ps", "gst", "status", "expiryDate", "mrp", "cost", "q", "since"])
    .map((r) => ({ ...r, ps: Math.max(1, n(r.ps)), gst: n(r.gst), mrp: n(r.mrp), cost: n(r.cost), q: n(r.q) }));
}

/** Sellable packs per medicine: ok, unexpired batches with stock (a batch below zero doesn't cancel another's stock). */
export function sellable(db: DriveDB, branchId: string, today = todayISO(), rows = batchStock(db, branchId)): Map<string, number> {
  const units = new Map<string, { q: number; ps: number }>();
  for (const b of rows) {
    if (b.status !== "ok" || b.expiryDate <= today) continue;
    const u = units.get(b.medicineId) ?? { q: 0, ps: b.ps };
    u.q += b.q; units.set(b.medicineId, u);
  }
  return new Map([...units].map(([id, u]) => [id, Math.floor(u.q / u.ps)]));
}

/** Average packs sold per day over the last `days` days, net of returns (loose units count as part-packs). */
export function velocity(db: DriveDB, branchId: string, days = 28, now = new Date()): Map<string, number> {
  return velocities(db, branchId, [days], now)[0];
}

/** Sales rates over several windows in one read (the longest window is scanned once). */
export function velocities(db: DriveDB, branchId: string, windows: number[], now = new Date()): Map<string, number>[] {
  const since = windows.map((d) => new Date(now.getTime() - d * DAY).toISOString());
  const rows = many<Record<string, number | string>>(db,
    `SELECT x.id, ${since.map((_, i) => `SUM(CASE WHEN x.at >= ? THEN x.q ELSE 0 END) AS w${i}`).join(", ")} FROM (
       SELECT si.medicineId AS id, s.at,
              (si.qty - (SELECT COALESCE(SUM(r.qty), 0) FROM salesReturnItem r WHERE r.saleItemId = si.id)) * 1.0 / CASE WHEN si.loose THEN si.packSize ELSE 1 END AS q
         FROM sale s JOIN saleItem si ON si.saleId = s.id WHERE s.branchId = ? AND s.at >= ?
     ) x GROUP BY x.id`, [...since, branchId, since.reduce((a, b) => (a < b ? a : b))], ["id", ...since.map((_, i) => `w${i}`)]);
  return windows.map((d, i) => new Map(rows.filter((r) => n(r[`w${i}`]) > 0).map((r) => [String(r.id), n(r[`w${i}`]) / d])));
}

/** Each medicine's last purchase in a branch: supplier and landed cost per pack (free packs spread over the paid ones). */
function lastBought(db: DriveDB, branchId: string) {
  const rows = many<{ id: string; supplierId: string; supplier: string; phone: string | null; cost: number }>(db,
    `SELECT x.medicineId AS id, x.supplierId, sp.name AS supplier, sp.phone, x.cost FROM (
       SELECT pi.medicineId, p.supplierId, ROUND(pi.costPaise * pi.packs * 1.0 / (pi.packs + pi.freePacks)) AS cost,
              ROW_NUMBER() OVER (PARTITION BY pi.medicineId ORDER BY p.at DESC, pi.id DESC) AS k
         FROM purchaseItem pi JOIN purchase p ON p.id = pi.purchaseId WHERE p.branchId = ?
     ) x JOIN supplier sp ON sp.id = x.supplierId WHERE x.k = 1`, [branchId], ["id", "supplierId", "supplier", "phone", "cost"]);
  return new Map(rows.map((r) => [r.id, { supplierId: r.supplierId, supplier: r.supplier, phone: r.phone, cost: n(r.cost) }]));
}

type Med = { id: string; name: string; packUnit: string; reorderLevel: number; mrpPaise: number };
const activeMeds = (db: DriveDB) => many<Med>(db, "SELECT id, name, packUnit, reorderLevel, mrpPaise FROM medicine WHERE deletedAt IS NULL AND active = 1", [], ["id", "name", "packUnit", "reorderLevel", "mrpPaise"]);

// ---------- reorder forecast ----------

/** Why a medicine is (or isn't) suggested; the screen words it. */
export type Why = "out" | "below" | "lead" | "ok" | "none";
export type ForecastRow = {
  id: string; name: string; unit: string; velocity: number; f14: number; stock: number; cover: number | null; lead: number; rop: number;
  reorderLevel: number; suggestion: number; why: Why; supplierId: string | null; supplier: string | null; cost: number;
};

/** Without a lead time on the counter's suppliers, the server's default of 1 day. */
export const LEAD_DAYS = 1;

/**
 * The web's reorder rule: reorder when stock won't last the lead time plus safety days at the 28-day sales rate, or is
 * below the medicine's reorder level; then order enough for the cover days on top of the reorder point.
 */
export function forecastRow(m: Med, stock: number, v: number, policy: Policy, sup: { supplierId: string; supplier: string; cost: number } | undefined): ForecastRow {
  const lead = LEAD_DAYS, rl = n(m.reorderLevel);
  const rop = Math.ceil(v * (lead + policy.safety)), target = Math.ceil(v * policy.cover);
  const trig = (v > 0 && stock <= rop) || stock < rl;
  const suggestion = trig ? Math.max(0, Math.max(target + rop, rl) - stock) : 0;
  const why: Why = suggestion ? (stock <= 0 ? "out" : stock < rl ? "below" : "lead") : v ? "ok" : "none";
  return {
    id: m.id, name: m.name, unit: m.packUnit, velocity: v, f14: Math.round(v * 14), stock, cover: v ? Math.floor(stock / v) : null, lead, rop, reorderLevel: rl,
    suggestion, why, supplierId: sup?.supplierId ?? null, supplier: sup?.supplier ?? null, cost: sup?.cost || Math.round(n(m.mrpPaise) * 0.7),
  };
}

/**
 * Forecast for every active medicine with sales, stock or a reorder level. Suggestions first (largest first), then the
 * rest by days of cover. `rows` is capped for the screen; `needs` holds every suggestion.
 */
export function forecast(db: DriveDB, branchId: string, policy: Policy, opts: { today?: string; now?: Date; limit?: number; stock?: BatchRow[]; vel?: Map<string, number> } = {}) {
  const today = opts.today ?? todayISO(), now = opts.now ?? new Date();
  const [stock, vel, last] = [sellable(db, branchId, today, opts.stock), opts.vel ?? velocity(db, branchId, 28, now), lastBought(db, branchId)];
  const all = activeMeds(db)
    .filter((m) => stock.has(m.id) || vel.has(m.id) || n(m.reorderLevel) > 0)
    .map((m) => forecastRow(m, stock.get(m.id) ?? 0, vel.get(m.id) ?? 0, policy, last.get(m.id)));
  const needs = all.filter((r) => r.suggestion > 0).sort((a, b) => b.suggestion - a.suggestion || a.name.localeCompare(b.name));
  const rest = all.filter((r) => !r.suggestion && r.velocity > 0).sort((a, b) => (a.cover ?? 1e9) - (b.cover ?? 1e9) || a.name.localeCompare(b.name));
  return { rows: [...needs, ...rest].slice(0, opts.limit ?? 400), needs, tracked: all.length };
}

/** Reorder needs of several branches, combined per supplier with each branch's share (the web's central buying). */
export function centralBuying(db: DriveDB, branches: { id: string; name: string }[], policy: Policy, today = todayISO(), stock = batchStock(db, null)) {
  const sups = new Map<string, { supplierId: string | null; supplier: string | null; value: number; lines: Map<string, { medicineId: string; name: string; unit: string; qty: Record<string, number>; total: number }> }>();
  for (const b of branches) for (const r of forecast(db, b.id, policy, { today, stock: stock.filter((x) => x.branchId === b.id) }).needs) {
    const k = r.supplierId ?? "";
    const s = sups.get(k) ?? { supplierId: r.supplierId, supplier: r.supplier, value: 0, lines: new Map() };
    const l = s.lines.get(r.id) ?? { medicineId: r.id, name: r.name, unit: r.unit, qty: {}, total: 0 };
    l.qty[b.id] = (l.qty[b.id] ?? 0) + r.suggestion; l.total += r.suggestion;
    s.value += r.suggestion * r.cost;
    s.lines.set(r.id, l); sups.set(k, s);
  }
  return {
    branches,
    suppliers: [...sups.values()].sort((a, b) => (a.supplierId ? 0 : 1) - (b.supplierId ? 0 : 1) || b.value - a.value)
      .map((s) => ({ ...s, lines: [...s.lines.values()].sort((a, b) => a.name.localeCompare(b.name)) })),
  };
}

// ---------- seasonal pre-stock ----------

/**
 * Items that sold above their average in each of the next four months, from up to 24 months of this branch's sales.
 * Needs 12 months of history. Uses the web's month maths (domain/intelligence/seasonal.ts).
 */
export function seasonal(db: DriveDB, branchId: string, now = new Date(), today = todayISO()) {
  const first = db.engine.all<{ at: string | null }>("SELECT MIN(at) AS at FROM sale WHERE branchId = ?", [branchId])[0]?.at;
  const months = first ? Math.floor((now.getTime() - Date.parse(first)) / (30.4 * DAY)) : 0;
  const cur = new Date(now.getTime() + IST).getUTCMonth();
  const targets = [1, 2, 3, 4].map((k) => (cur + k) % 12);
  if (months < 12) return { ready: false as const, months, cur, targets, plans: {} as Record<number, SeasonalRow[]> };
  // Whole months (India time) from about two years back, so the counted window and the month sums agree.
  const back = new Date(now.getTime() - 730 * DAY + IST), since = new Date(Date.UTC(back.getUTCFullYear(), back.getUTCMonth(), 1) - IST);
  catchUp(db, "si");
  const sums = many<Record<string, number | string>>(db,
    `SELECT x.medicineId AS id, md.name, md.packUnit AS unit, ${Array.from({ length: 12 }, (_, i) => `SUM(CASE WHEN substr(x.ym, 6, 2) = '${String(i + 1).padStart(2, "0")}' THEN x.q ELSE 0 END) AS m${i}`).join(", ")}
       FROM temp.intel_mq x JOIN medicine md ON md.id = x.medicineId
      WHERE x.branchId = ? AND x.ym >= ? AND md.deletedAt IS NULL AND md.active = 1 GROUP BY x.medicineId`,
    [branchId, new Date(since.getTime() + IST).toISOString().slice(0, 7)], ["id", "name", "unit", ...Array.from({ length: 12 }, (_, i) => `m${i}`)]);
  const stock = sellable(db, branchId, today);
  const cov = monthCoverage(new Date(Math.max(Date.parse(first!), since.getTime())), now);
  const plans: Record<number, SeasonalRow[]> = {};
  for (const target of targets) {
    const plan: SeasonalRow[] = [];
    for (const r of sums) {
      const l = seasonalLine(Array.from({ length: 12 }, (_, i) => n(r[`m${i}`])), cov, target, cur);
      if (!l || l.lift < 10) continue;
      const id = String(r.id), st = stock.get(id) ?? 0, atStart = Math.max(0, Math.floor(st - l.consumed));
      plan.push({ id, name: String(r.name), unit: String(r.unit), lift: l.lift, expected: l.expected, stock: st, atStart, need: Math.max(0, l.expected - atStart), bars: l.bars });
    }
    plans[target] = plan.sort((a, b) => b.lift - a.lift).slice(0, 60);
  }
  return { ready: true as const, months, cur, targets, plans };
}

export type SeasonalRow = { id: string; name: string; unit: string; lift: number; expected: number; stock: number; atStart: number; need: number; bars: number[] };

// ---------- supplier prices ----------

/** Latest landed cost per pack from each supplier, for medicines bought from more than one (from purchase bills). */
export function priceComparison(db: DriveDB, limit = 50) {
  const rows = db.engine.all<{ medicineId: string; name: string; supplier: string; rate: number; ptr: number; packs: number; free: number; at: string }>(
    `SELECT x.medicineId, md.name, sp.name AS supplier, x.rate, x.ptr, x.packs, x.free, x.at FROM (
       SELECT pi.medicineId, p.supplierId, ROUND(pi.costPaise * pi.packs * 1.0 / (pi.packs + pi.freePacks)) AS rate, pi.costPaise AS ptr,
              pi.packs, pi.freePacks AS free, p.at, ROW_NUMBER() OVER (PARTITION BY pi.medicineId, p.supplierId ORDER BY p.at DESC, pi.id DESC) AS k
         FROM purchaseItem pi JOIN purchase p ON p.id = pi.purchaseId
        WHERE pi.medicineId IN (SELECT pi2.medicineId FROM purchaseItem pi2 JOIN purchase p2 ON p2.id = pi2.purchaseId GROUP BY pi2.medicineId HAVING COUNT(DISTINCT p2.supplierId) > 1)
     ) x JOIN supplier sp ON sp.id = x.supplierId JOIN medicine md ON md.id = x.medicineId WHERE x.k = 1`);
  const by = new Map<string, typeof rows>();
  for (const r of rows) by.set(r.medicineId, [...(by.get(r.medicineId) ?? []), r]);
  return [...by.values()].map((rs) => {
    const last = [...rs].sort((a, b) => b.at.localeCompare(a.at))[0], best = [...rs].sort((a, b) => n(a.rate) - n(b.rate))[0];
    return {
      name: rs[0].name,
      quotes: rs.sort((a, b) => n(a.rate) - n(b.rate)).map((r) => ({ supplier: r.supplier, rate: n(r.rate), ptr: n(r.ptr), deal: n(r.free) ? `${n(r.packs)}+${n(r.free)}` : "", date: r.at })),
      best: best.supplier, savingPct: n(last.rate) > n(best.rate) ? ((n(last.rate) - n(best.rate)) / n(last.rate)) * 100 : 0,
    };
  }).sort((a, b) => b.savingPct - a.savingPct || a.name.localeCompare(b.name)).slice(0, limit);
}

// ---------- slow and dead stock ----------

export type SlowKind = "dead" | "slow" | "over";
/** Stock on the shelf 30+ days that sells under one a week, or would last more than 90 days. Value at landed cost. */
export function slowStock(db: DriveDB, branchId: string, opts: { now?: Date; limit?: number; stock?: BatchRow[]; vel90?: Map<string, number> } = {}) {
  const now = opts.now ?? new Date(), rows = opts.stock ?? batchStock(db, branchId), vel = opts.vel90 ?? velocity(db, branchId, 90, now);
  const by = new Map<string, { id: string; name: string; qty: number; value: number; age: number; ps: number }>();
  for (const b of rows) {
    const x = by.get(b.medicineId) ?? { id: b.medicineId, name: b.name, qty: 0, value: 0, age: 0, ps: b.ps };
    x.qty += b.q; x.value += stockValue(b.cost, b.q, x.ps); x.age = Math.max(x.age, Math.floor((now.getTime() - Date.parse(b.since)) / DAY));
    by.set(b.medicineId, x);
  }
  return [...by.values()].map((x) => { const v = vel.get(x.id) ?? 0; return { ...x, packs: Math.floor(x.qty / x.ps), velocity: v, cover: v ? Math.floor(x.qty / x.ps / v) : null }; })
    .filter((x) => x.age >= 30 && (x.velocity < 1 / 7 || (x.cover ?? 9999) > 90))
    .map((x) => ({ ...x, kind: (x.velocity === 0 ? "dead" : x.velocity < 1 / 7 ? "slow" : "over") as SlowKind }))
    .sort((a, b) => b.value - a.value).slice(0, opts.limit ?? 50);
}

// ---------- anomalies ----------

export type AnomalyRule = "disc" | "refunds" | "count" | "cost" | "night";
export type Anomaly = { key: string; rule: AnomalyRule; sev: "amber" | "red" | "gray"; vars: Record<string, string | number>; who: string; at: string; reviewed: { by: string; at: string } | null };
type Reviewed = Record<string, { by: string; at: string; label: string }>;
const reviewedOf = (db: DriveDB) => parseMeta<Reviewed>(db, "intel:reviewed", {});

/**
 * Signals to review from the last 7 days: discounts above the limit, more refunds in a day than the limit by one
 * person, stock counts off by more than ₹500, purchase rates up more than 3%, and bills made between 11 pm and 6 am.
 */
export function anomalies(db: DriveDB, branchId: string, th: Thresholds, now = new Date()): Anomaly[] {
  const since = new Date(now.getTime() - 7 * DAY).toISOString();
  const users = new Map((JSON.parse(db.getMeta("users") ?? "[]") as { id: string; name: string }[]).map((u) => [u.id, u.name]));
  const me = db.getMeta("userId");
  const name = (id: string | null) => (id && users.get(id)) || (id && id === me ? db.getMeta("userName") ?? "" : "") || "Unknown";
  const out: Omit<Anomaly, "reviewed">[] = [];

  for (const s of db.engine.all<{ id: string; invoiceNo: string; pct: number; userId: string; at: string }>(
    "SELECT id, invoiceNo, discountPct AS pct, userId, at FROM sale WHERE branchId = ? AND at >= ? AND discountPct > ?", [branchId, since, th.disc]))
    out.push({ key: "disc:" + s.id, rule: "disc", sev: "amber", vars: { limit: th.disc, pct: n(s.pct), bill: s.invoiceNo }, who: name(s.userId), at: s.at });

  for (const r of db.engine.all<{ userId: string; d: string; c: number }>(
    "SELECT userId, date(at, '+330 minutes') AS d, COUNT(*) AS c FROM salesReturn WHERE branchId = ? AND at >= ? GROUP BY 1, 2 HAVING COUNT(*) > ?", [branchId, since, th.refunds]))
    out.push({ key: `ref:${r.userId}|${r.d}`, rule: "refunds", sev: "red", vars: { limit: th.refunds, n: n(r.c), date: r.d }, who: name(r.userId), at: r.d + "T12:00:00.000Z" });

  for (const c of db.engine.all<{ refId: string; userId: string; at: string; v: number }>(
    `SELECT m.refId, MIN(m.userId) AS userId, MIN(m.at) AS at, ROUND(SUM(m.qty * b.costPaise * 1.0 / md.packSize)) AS v
       FROM stockMovement m JOIN batch b ON b.id = m.batchId JOIN medicine md ON md.id = b.medicineId
      WHERE m.refType = 'count' AND m.branchId = ? AND m.at >= ? GROUP BY m.refId`, [branchId, since]))
    if (Math.abs(n(c.v)) > 50000) out.push({ key: "count:" + c.refId, rule: "count", sev: "amber", vars: { value: n(c.v), date: c.at.slice(0, 10) }, who: name(c.userId), at: c.at });

  // Rate on the latest bill against the bill before it (a different purchase), for medicines bought this week.
  const buys = db.engine.all<{ medicineId: string; name: string; purchaseId: string; c: number; at: string }>(
    `SELECT pi.medicineId, md.name, pi.purchaseId, pi.costPaise AS c, p.at FROM purchaseItem pi JOIN purchase p ON p.id = pi.purchaseId JOIN medicine md ON md.id = pi.medicineId
      WHERE pi.medicineId IN (SELECT pi2.medicineId FROM purchase p2 JOIN purchaseItem pi2 ON pi2.purchaseId = p2.id WHERE p2.at >= ?)
      ORDER BY pi.medicineId, p.at DESC, pi.id DESC`, [since]);
  for (let i = 0; i < buys.length;) {
    let j = i;
    while (j < buys.length && buys[j].medicineId === buys[i].medicineId) j++;
    const a = buys[i], b = buys.slice(i, j).find((x) => x.purchaseId !== a.purchaseId);
    if (b && a.at >= since && n(a.c) > n(b.c) * 1.03) out.push({ key: `cost:${a.medicineId}:${a.at}`, rule: "cost", sev: "gray", vars: { name: a.name, prev: n(b.c), cur: n(a.c), pct: ((n(a.c) - n(b.c)) / n(b.c)) * 100 }, who: "", at: a.at });
    i = j;
  }

  for (const s of db.engine.all<{ userId: string; d: string; c: number; first: string; at: string }>(
    `SELECT userId, date(at, '+330 minutes') AS d, COUNT(*) AS c, MIN(invoiceNo) AS first, MAX(at) AS at FROM sale
      WHERE branchId = ? AND at >= ? AND CAST(strftime('%H', at, '+330 minutes') AS INTEGER) NOT BETWEEN 6 AND 22 GROUP BY 1, 2`, [branchId, since]))
    out.push({ key: `night:${s.userId}|${s.d}`, rule: "night", sev: "amber", vars: { n: n(s.c), date: s.d, bill: s.first }, who: name(s.userId), at: s.at });

  const done = reviewedOf(db);
  return out.sort((a, b) => b.at.localeCompare(a.at)).map((a) => ({ ...a, reviewed: done[a.key] ? { by: done[a.key].by, at: done[a.key].at } : null }));
}

/** Marks a signal as looked at (kept 30 days, on this device). */
export function markReviewed(db: DriveDB, key: string, label: string, by: string, now = new Date()) {
  if (!key.trim()) throw new CounterError("Nothing to mark.");
  const cutoff = new Date(now.getTime() - 30 * DAY).toISOString();
  const keep = Object.fromEntries(Object.entries(reviewedOf(db)).filter(([, v]) => v.at >= cutoff));
  keep[key.slice(0, 200)] = { by: by.slice(0, 80) || "Unknown", at: now.toISOString(), label: label.slice(0, 200) };
  db.setMeta("intel:reviewed", JSON.stringify(keep));
  return keep[key.slice(0, 200)];
}

// ---------- margins ----------

export type MarginBy = "item" | "category" | "supplier";
export type MarginRow = { key: string; name: string; qty: number; sales: number; cost: number; margin: number; pct: number | null };

/** Landed share of a batch's cost: paid packs over paid + free packs on its purchase bill(s). */
const LANDED = "LEFT JOIN temp.intel_lc lc ON lc.batchId = si.batchId";

/**
 * Realised margin between two instants: selling value excluding GST, net of returned units, against landed cost
 * (cost on the bill line, free goods spread over paid ones), by item, category (dosage form) and supplier (the one the
 * batch was bought from). One read, rolled up three ways.
 */
export function salesMarginsAll(db: DriveDB, branchId: string, from: string, to: string): Record<MarginBy, MarginRow[]> {
  catchUp(db, "pi");
  const rows = many<{ id: string; name: string; form: string; sup: string; supName: string | null; qty: number; sales: number; cost: number }>(db,
    `SELECT si.medicineId AS id, MIN(TRIM(md.name || ' ' || md.strength)) AS name, MIN(md.form) AS form, COALESCE(lc.supplierId, '') AS sup, MIN(sp.name) AS supName,
            SUM(si.net) AS qty, SUM(si.taxablePaise * si.net * 1.0 / si.qty) AS sales, SUM(si.costPaise * si.net * COALESCE(lc.paid * 1.0 / lc.got, 1)) AS cost
       FROM (SELECT si.batchId, si.medicineId, si.qty, si.taxablePaise, si.costPaise,
                    si.qty - (SELECT COALESCE(SUM(r.qty), 0) FROM salesReturnItem r WHERE r.saleItemId = si.id) AS net
               FROM sale s JOIN saleItem si ON si.saleId = s.id WHERE s.branchId = ? AND s.at >= ? AND s.at < ? AND si.qty > 0) si
       JOIN medicine md ON md.id = si.medicineId ${LANDED} LEFT JOIN supplier sp ON sp.id = lc.supplierId
      GROUP BY si.medicineId, COALESCE(lc.supplierId, '')`, [branchId, from, to], ["id", "name", "form", "sup", "supName", "qty", "sales", "cost"]);
  const roll = (key: (r: (typeof rows)[number]) => string, label: (r: (typeof rows)[number]) => string) => {
    const by = new Map<string, { key: string; name: string; qty: number; sales: number; cost: number }>();
    for (const r of rows) {
      const k = key(r), x = by.get(k) ?? { key: k, name: label(r), qty: 0, sales: 0, cost: 0 };
      x.qty += n(r.qty); x.sales += n(r.sales); x.cost += n(r.cost);
      by.set(k, x);
    }
    return [...by.values()].map((x) => { const sales = Math.round(x.sales), cost = Math.round(x.cost); return { ...x, sales, cost, margin: sales - cost, pct: marginPct(sales, cost) }; })
      .filter((r) => r.qty > 0).sort((a, b) => b.margin - a.margin);
  };
  return {
    item: roll((r) => r.id, (r) => r.name),
    category: roll((r) => r.form ?? "", (r) => r.form || "—"),
    supplier: roll((r) => r.sup, (r) => r.supName ?? ""),
  };
}
export const salesMargins = (db: DriveDB, branchId: string, from: string, to: string, by: MarginBy) => salesMarginsAll(db, branchId, from, to)[by];

/** Margin on stock in hand: MRP excluding GST against each batch's landed cost. Lowest margin first. */
export function stockMargins(db: DriveDB, branchId: string, rows = batchStock(db, branchId)) {
  const by = new Map<string, { id: string; name: string; qty: number; sell: number; cost: number }>();
  for (const b of rows) {
    const x = by.get(b.medicineId) ?? { id: b.medicineId, name: b.name, qty: 0, sell: 0, cost: 0 };
    x.qty += b.q; x.sell += stockValue(exGst(b.mrp, b.gst), b.q, b.ps); x.cost += stockValue(b.cost, b.q, b.ps);
    by.set(b.medicineId, x);
  }
  return [...by.values()].map((x) => ({ ...x, margin: x.sell - x.cost, pct: marginPct(x.sell, x.cost) })).sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0));
}

// ---------- the screen ----------

/**
 * Everything the stock intelligence screen shows except the seasonal planner (its own call, as it reads up to two
 * years of bills). Stock is read once and shared.
 */
export function insights(db: DriveDB, branchId: string, opts: { branches?: { id: string; name: string }[]; now?: Date } = {}) {
  const now = opts.now ?? new Date(), today = todayISO(now);
  const s = intelSettings(db);
  const from = istMidnight(addDays(today, -29)).toISOString(), to = now.toISOString();
  const central = (opts.branches ?? []).length > 1;
  const all = central ? batchStock(db, null) : null, stock = all ? all.filter((b) => b.branchId === branchId) : batchStock(db, branchId);
  const [vel, vel90] = velocities(db, branchId, [28, 90], now);
  return {
    settings: s,
    forecast: forecast(db, branchId, s.policy, { today, now, stock, vel }),
    prices: priceComparison(db),
    slow: slowStock(db, branchId, { now, stock, vel90 }),
    anomalies: anomalies(db, branchId, s.anomaly, now),
    margins: { ...salesMarginsAll(db, branchId, from, to), stock: stockMargins(db, branchId, stock) },
    central: all ? centralBuying(db, opts.branches!, s.policy, today, all) : null,
  };
}
export type Insights = ReturnType<typeof insights>;

// ---------- the draft order list ----------

export type DraftLine = { medicineId: string; name: string; unit: string; qty: number; ratePaise: number; supplierId: string | null };
const draftInput = z.array(z.object({
  medicineId: z.string().min(1), name: z.string().max(200), unit: z.string().max(20), qty: z.number().int().min(1, "Quantities must be 1 or more.").max(100_000),
  ratePaise: z.number().int().min(0).max(10_000_000_00), supplierId: z.string().nullable(),
})).max(2000, "The list is too long. Order in parts.");

/** This device's draft order list (kept until cleared). */
export function getDraft(db: DriveDB): { lines: DraftLine[]; at: string | null } {
  return parseMeta(db, "intel:draft", { lines: [] as DraftLine[], at: null as string | null });
}
export function saveDraft(db: DriveDB, lines: DraftLine[]) {
  const r = draftInput.safeParse(lines);
  if (!r.success) throw new CounterError(r.error.issues[0]?.message ?? "Check the list.");
  const d = { lines: r.data, at: r.data.length ? new Date().toISOString() : null };
  db.setMeta("intel:draft", JSON.stringify(d));
  return d;
}

/** Adds lines to the draft: a medicine already on it keeps the larger quantity (adding twice never doubles an order). */
export function addToDraft(db: DriveDB, lines: DraftLine[]) {
  const cur = new Map(getDraft(db).lines.map((l) => [l.medicineId, l]));
  for (const l of lines) {
    const had = cur.get(l.medicineId);
    cur.set(l.medicineId, had ? { ...had, qty: Math.max(had.qty, l.qty), supplierId: had.supplierId ?? l.supplierId } : l);
  }
  return saveDraft(db, [...cur.values()]);
}

/** The reorder suggestions as draft lines, each with its last supplier. */
export function suggestionLines(db: DriveDB, branchId: string, policy = intelSettings(db).policy): DraftLine[] {
  return forecast(db, branchId, policy).needs.map((r) => ({ medicineId: r.id, name: r.name, unit: r.unit, qty: r.suggestion, ratePaise: r.cost, supplierId: r.supplierId }));
}

/** Draft lines for chosen medicines (e.g. seasonal pre-stock), each with its last supplier and landed cost. */
export function linesFor(db: DriveDB, branchId: string, items: { medicineId: string; qty: number }[]): DraftLine[] {
  if (!items.length) return [];
  const last = lastBought(db, branchId);
  const meds = new Map(many<Med>(db, `SELECT id, name, packUnit, reorderLevel, mrpPaise FROM medicine WHERE id IN (${items.map(() => "?").join(", ")})`, items.map((i) => i.medicineId), ["id", "name", "packUnit", "reorderLevel", "mrpPaise"]).map((m) => [m.id, m]));
  return items.flatMap((i) => {
    const m = meds.get(i.medicineId), l = last.get(i.medicineId);
    return m && i.qty > 0 ? [{ medicineId: m.id, name: m.name, unit: m.packUnit, qty: i.qty, ratePaise: l?.cost || Math.round(n(m.mrpPaise) * 0.7), supplierId: l?.supplierId ?? null }] : [];
  });
}

/** The draft grouped by supplier (with the supplier's phone for WhatsApp), suppliers A–Z and "no supplier" last. */
export function draftGroups(db: DriveDB, lines = getDraft(db).lines) {
  const sups = new Map(db.engine.all<{ id: string; name: string; phone: string | null }>("SELECT id, name, phone FROM supplier WHERE deletedAt IS NULL").map((s) => [s.id, s]));
  const by = new Map<string, { supplierId: string | null; supplier: string | null; phone: string | null; lines: DraftLine[]; valuePaise: number }>();
  for (const l of lines) {
    const s = l.supplierId ? sups.get(l.supplierId) : undefined, k = s?.id ?? "";
    const g = by.get(k) ?? { supplierId: s?.id ?? null, supplier: s?.name ?? null, phone: s?.phone ?? null, lines: [], valuePaise: 0 };
    g.lines.push(l); g.valuePaise += l.qty * l.ratePaise;
    by.set(k, g);
  }
  return [...by.values()].map((g) => ({ ...g, lines: g.lines.sort((a, b) => a.name.localeCompare(b.name)) }))
    .sort((a, b) => (a.supplierId ? 0 : 1) - (b.supplierId ? 0 : 1) || (a.supplier ?? "").localeCompare(b.supplier ?? ""));
}
export type DraftGroup = ReturnType<typeof draftGroups>[number];

/** An order to a supplier as WhatsApp text. In English, like the bills shared from the counter. */
export function orderText(g: Pick<DraftGroup, "supplier" | "lines">, pharmacy: Pharmacy | null, date = new Date()) {
  return [
    `Order from ${pharmacy?.tradeName || pharmacy?.name || "our pharmacy"}`,
    `${date.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}${g.supplier ? ` · To ${g.supplier}` : ""}`,
    "",
    ...g.lines.map((l, i) => `${i + 1}. ${l.name} × ${l.qty} ${l.unit}${l.qty === 1 ? "" : "s"}`),
    "",
    "Please confirm availability, rates and expiry. Thank you.",
    pharmacy?.phone ? `Call ${pharmacy.phone}` : "",
  ].filter((x, i, a) => x !== "" || (i > 0 && a[i - 1] !== "")).join("\n").trim();
}

/** The draft as CSV rows (one header row), rates and values in rupees. */
export function draftCsv(groups: DraftGroup[]): (string | number)[][] {
  return [["Supplier", "Medicine", "Quantity", "Unit", "Rate (₹)", "Value (₹)"],
    ...groups.flatMap((g) => g.lines.map((l) => [g.supplier ?? "", l.name, l.qty, l.unit, (l.ratePaise / 100).toFixed(2), ((l.qty * l.ratePaise) / 100).toFixed(2)]))];
}

/** The draft as the screen shows it: grouped by supplier, with when it was last changed. */
export const draftView = (db: DriveDB) => { const d = getDraft(db); return { at: d.at, groups: draftGroups(db, d.lines) }; };
