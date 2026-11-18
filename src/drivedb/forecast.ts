/**
 * Demand forecast on the counter (Drive mode): the same statistical model as Medoro's web screen
 * (/app/intelligence/forecast, src/domain/intelligence/forecast-model.ts and forecast-row.ts), worked out on this device from
 * its own bills, so a pharmacy whose records live in its Google Drive gets it without sending anything to Medoro.
 *
 * It is a statistical estimate, not a fact and not machine learning; items without 28 days of history and 5 selling days get
 * no forecast at all. Differences from the web, because the counter keeps no such records:
 *  - no purchase orders, so nothing is "on order" and the order list is the draft list (see insights.ts);
 *  - no supplier lead times: 1 day is used (the same default as the counter's reorder list), and the screen says so;
 *  - the weekly snapshots used to score past forecasts are this device's own (meta, not synced), saved the first time the
 *    screen is opened in a week, because the counter has no daily job. Nothing is back-filled.
 */
import type { DriveDB } from "./client";
import { batchStock, intelSettings, LEAD_DAYS, type BatchRow } from "./insights";
import { addDays, todayISO } from "@/lib/dates";
import { buildForecastRow, byUrgency, portfolioOf, scoreSnapshots, METHOD, type Accuracy, type ForecastRow, type Portfolio, type Snap } from "@/domain/intelligence/forecast-row";

export type { Accuracy, ForecastRow, Portfolio };
const HISTORY_DAYS = 180, MAX_ROWS = 300, DAY = 86400_000;
const n = (v: unknown) => Number(v ?? 0);

/** Rows of a query as one JSON text (quicker than one JS object per row on SQLite WebAssembly). */
function many<T>(db: DriveDB, sql: string, params: (string | number)[], cols: readonly string[]): T[] {
  const j = db.engine.all<{ j: string | null }>(`SELECT json_group_array(json_array(${cols.map((c) => `q."${c}"`).join(", ")})) AS j FROM (${sql}) q`, params)[0]?.j;
  return (JSON.parse(j ?? "[]") as unknown[][]).map((a) => Object.fromEntries(cols.map((c, i) => [c, a[i]])) as T);
}

/** Packs sold per medicine per IST day, net of returns (loose units as part-packs), from `fromDay` up to but not including `toDay`. */
function soldByDay(db: DriveDB, branchId: string, fromDay: string, toDay: string) {
  const from = new Date(Date.parse(fromDay + "T00:00:00Z") - 330 * 60000).toISOString(), to = new Date(Date.parse(toDay + "T00:00:00Z") - 330 * 60000).toISOString();
  return many<{ id: string; day: string; q: number }>(db,
    `SELECT si.medicineId AS id, date(s.at, '+330 minutes') AS day,
            SUM((si.qty - (SELECT COALESCE(SUM(r.qty), 0) FROM salesReturnItem r WHERE r.saleItemId = si.id)) * 1.0 / CASE WHEN si.loose THEN si.packSize ELSE 1 END) AS q
       FROM sale s JOIN saleItem si ON si.saleId = s.id WHERE s.branchId = ? AND s.at >= ? AND s.at < ? GROUP BY 1, 2`, [branchId, from, to], ["id", "day", "q"]);
}

/**
 * Dense daily series per active medicine ending yesterday. Zeros before the branch or the item existed are not demand and are
 * cut off: it existed from its first stock or its first sale, whichever is earlier (stock may be entered after sales).
 */
function history(db: DriveDB, branchId: string, today: string) {
  const startDay = addDays(today, -HISTORY_DAYS);
  const rows = soldByDay(db, branchId, startDay, today);
  const first = many<{ d: string | null }>(db, "SELECT MIN(at) AS d FROM sale WHERE branchId = ?", [branchId], ["d"])[0]?.d;
  const stocked = many<{ id: string; d: string }>(db,
    `SELECT b.medicineId AS id, MIN(m.at) AS d FROM stockMovement m JOIN batch b ON b.id = m.batchId WHERE b.branchId = ? GROUP BY 1`, [branchId], ["id", "d"]);
  const ist = (iso: string) => new Date(Date.parse(iso) + 330 * 60000).toISOString().slice(0, 10);
  const branchStart = first ? ist(first) : today, firstStock = new Map(stocked.map((s) => [s.id, ist(s.d)]));
  const byMed = new Map<string, Map<string, number>>();
  for (const r of rows) { const m = byMed.get(r.id) ?? new Map<string, number>(); m.set(r.day, n(r.q)); byMed.set(r.id, m); }
  const out = new Map<string, { series: number[]; startWeekday: number }>();
  const recentFrom = addDays(today, -90);
  for (const [id, days] of byMed) {
    if (![...days.keys()].some((d) => d >= recentFrom)) continue;
    const firstSale = [...days.keys()].sort()[0], existed = [firstStock.get(id) ?? firstSale, firstSale].sort()[0];
    const start = [startDay, branchStart, existed].sort().at(-1)!;
    const len = Math.round((Date.parse(today) - Date.parse(start)) / DAY);
    out.set(id, { series: Array.from({ length: len }, (_, i) => days.get(addDays(start, i)) ?? 0), startWeekday: new Date(start + "T00:00:00Z").getUTCDay() });
  }
  return out;
}

export type ForecastView = {
  generatedOn: string; policy: { cover: number; safety: number }; rows: ForecastRow[]; insufficient: number; portfolio: Portfolio;
  /** Recommendations excluded from "add to order list" by default because the model's own track record on them is poor. */
  lowConfidence: number;
};

/** The forecast of one branch, from this device's records. Reads only. */
export function deviceForecast(db: DriveDB, branchId: string, opts: { now?: Date; stock?: BatchRow[] } = {}): ForecastView {
  const now = opts.now ?? new Date(), today = todayISO(now), nextWeekday = new Date(today + "T00:00:00Z").getUTCDay();
  const policy = intelSettings(db).policy, hist = history(db, branchId, today), stock = opts.stock ?? batchStock(db, branchId);
  const meds = new Map(many<{ id: string; name: string; packSize: number; mrp: number; unit: string }>(db,
    "SELECT id, TRIM(name || ' ' || strength) AS name, packSize, mrpPaise AS mrp, packUnit AS unit FROM medicine WHERE deletedAt IS NULL", [], ["id", "name", "packSize", "mrp", "unit"]).map((m) => [m.id, m]));
  const last = new Map(many<{ id: string; supplierId: string; supplier: string; cost: number }>(db,
    `SELECT x.medicineId AS id, x.supplierId, sp.name AS supplier, x.cost FROM (
       SELECT pi.medicineId, p.supplierId, ROUND(pi.costPaise * pi.packs * 1.0 / (pi.packs + pi.freePacks)) AS cost,
              ROW_NUMBER() OVER (PARTITION BY pi.medicineId ORDER BY p.at DESC, pi.id DESC) AS k
         FROM purchaseItem pi JOIN purchase p ON p.id = pi.purchaseId WHERE p.branchId = ?
     ) x JOIN supplier sp ON sp.id = x.supplierId WHERE x.k = 1`, [branchId], ["id", "supplierId", "supplier", "cost"]).map((r) => [r.id, r]));
  const batchNo = new Map(many<{ id: string; no: string }>(db, "SELECT id, batchNo AS no FROM batch WHERE branchId = ? AND deletedAt IS NULL", [branchId], ["id", "no"]).map((b) => [b.id, b.no]));
  const rows: ForecastRow[] = [], bts: Parameters<typeof portfolioOf>[0] = [];
  let insufficient = 0;
  for (const [id, h] of hist) {
    const med = meds.get(id);
    if (!med) continue;
    const mine = stock.filter((b) => b.medicineId === id);
    const sellable = mine.filter((b) => b.status === "ok" && b.expiryDate > today);
    const lb = last.get(id);
    const built = buildForecastRow({
      id, name: med.name, series: h.series, startWeekday: h.startWeekday, nextWeekday, cover: policy.cover,
      stock: Math.floor(sellable.reduce((a, b) => a + b.q, 0) / Math.max(1, n(med.packSize))), inboundRows: [],
      lead: { days: LEAD_DAYS, source: "counter default" },
      batches: sellable.map((b) => ({ id: b.id, batchNo: batchNo.get(b.id) ?? b.id.slice(0, 6), qty: b.q / b.ps, daysToExpiry: Math.round((Date.parse(b.expiryDate) - Date.parse(today)) / DAY), costPaise: b.cost })),
      supplier: lb ? { id: lb.supplierId, name: lb.supplier } : null, ratePaise: lb ? n(lb.cost) : Math.round(n(med.mrp) * 0.7),
    });
    if (!built) { insufficient++; continue; }
    rows.push(built.row); bts.push(built.bt);
  }
  rows.sort(byUrgency);
  return { generatedOn: today, policy, rows: rows.slice(0, MAX_ROWS), insufficient, portfolio: portfolioOf(bts), lowConfidence: rows.filter((r) => r.rec && r.confidence === "low").length };
}

// ---------- scoring forecasts that were actually made (this device only) ----------

const KEY = "forecast:snaps", KEEP_WEEKS = 12;
type Stored = Record<string, { on: string; items: [string, number, number, number][] }[]>; // branchId → weekly snapshots, newest first

function readStored(db: DriveDB): Stored { try { return JSON.parse(db.getMeta(KEY) ?? "{}") as Stored; } catch { return {}; } }

/** Saves this week's forecast (once per 7 days) so it can be scored when its week is over. Returns whether one was saved. */
export function snapshotIfDue(db: DriveDB, branchId: string, view: ForecastView): boolean {
  if (!view.rows.length) return false;
  const all = readStored(db), mine = all[branchId] ?? [];
  if (mine[0] && mine[0].on >= addDays(view.generatedOn, -6)) return false;
  all[branchId] = [{ on: view.generatedOn, items: view.rows.map((r) => [r.medicineId, r.week.point, r.week.lo, r.week.hi] as [string, number, number, number]) }, ...mine].slice(0, KEEP_WEEKS);
  db.setMeta(KEY, JSON.stringify(all));
  return true;
}

/** How the forecasts this counter actually made did once their week was over. Only completed weeks count. */
export function deviceAccuracy(db: DriveDB, branchId: string, now = new Date()): Accuracy {
  const today = todayISO(now), cutoff = addDays(today, -7), mine = readStored(db)[branchId] ?? [];
  const done = mine.filter((w) => w.on <= cutoff), pending = mine.length - done.length;
  if (!done.length) return scoreSnapshots([], () => 0, pending);
  const oldest = done.at(-1)!.on, sold = soldByDay(db, branchId, oldest, today);
  const actual = (med: string, from: string) => sold.filter((x) => x.id === med && x.day >= from && x.day < addDays(from, 7)).reduce((a, x) => a + n(x.q), 0);
  const snaps: Snap[] = done.flatMap((w) => w.items.map(([medicineId, predicted, lo, hi]) => ({ medicineId, generatedOn: w.on, predicted, lo, hi })));
  return scoreSnapshots(snaps, actual, pending);
}

/** Everything the screen needs in one call; saves this week's snapshot when none is due-saved yet. */
export function forecastScreen(db: DriveDB, branchId: string, now = new Date()) {
  const view = deviceForecast(db, branchId, { now });
  const saved = snapshotIfDue(db, branchId, view);
  return { ...view, method: METHOD, accuracy: deviceAccuracy(db, branchId, now), snapshotSaved: saved };
}
export type ForecastScreen = ReturnType<typeof forecastScreen>;
