/**
 * Phase 7: loads a pharmacy's full data from Medoro into this (empty) device database, then checks it against
 * the counts and totals Medoro computed. Ids are kept, so bills, returns and stock line up exactly.
 */
import type { DriveDB } from "./client";
import { TABLES, type TableName } from "./schema";
import { CounterError } from "./pharmacy";
import { seriesFor } from "./seed";
import { customerBalance } from "./trade";
import { supplierDues } from "./books";
import { validSeries } from "@/lib/docno";
import type { MoneyRow, MoveBase, MovePart } from "@/domain/system/drive-move";

type Row = Record<string, string | number | boolean | null>;
export type MoveCheck = { name: string; ok: boolean; expected: number; got: number; detail?: string };
export type MoveResult = { ok: boolean; checks: MoveCheck[] };

const IN_PROGRESS = "moveInProgress";
export const moveInProgress = (db: DriveDB) => db.getMeta(IN_PROGRESS) === "1";

/** Step 1: catalogue, batches, customers and suppliers. The device must be empty. */
export function beginMove(db: DriveDB, base: MoveBase) {
  if (base?.v !== 1) throw new CounterError("This copy is from a newer Medoro. Reload the page and try again.");
  if (db.from("medicine").withDeleted().count() > 0 || db.from("sale").count() > 0) throw new CounterError("This device already has pharmacy data. Reset it before moving.");
  db.transaction(() => {
    db.setMeta(IN_PROGRESS, "1");
    if (base.medicines.length) db.from("medicine").insert(base.medicines);
    if (base.batches.length) db.from("batch").insert(base.batches);
    if (base.customers.length) db.from("customer").insert(base.customers.map((c) => ({ id: c.id, name: c.name, phone: c.phone, gstin: c.gstin, creditLimitPaise: c.creditLimitPaise, address: c.address, pincode: c.pincode })));
    const erased = base.customers.filter((c) => c.erased).map((c) => c.id);
    if (erased.length) db.from("customer").in("id", erased).delete();
    const offers = base.customers.flatMap((c) => ("offers" in c && c.offers && !c.erased ? [{ customerId: c.id, purpose: "offers", channel: "whatsapp", granted: 1, method: `Moved from Medoro: ${c.offers.method}`.slice(0, 80), userId: "medoro-move", at: c.offers.at }] : []));
    if (offers.length) db.from("customerConsent").insert(offers);
    if (base.suppliers.length) db.from("supplier").insert(base.suppliers);
  });
}

/** Step 2: one page of a part, as moveExport returned it. Parts must come in order: sales, returns, purchases, movements, loyalty, money. */
export function importPart(db: DriveDB, part: Exclude<MovePart, "base">, rows: unknown[]) {
  if (!moveInProgress(db)) throw new CounterError("Start the move again.");
  if (!rows.length) return 0;
  db.transaction(() => {
    switch (part) {
      case "sales": {
        const list = rows as { sale: Row; items: Row[]; payments: Row[] }[];
        db.from("sale").insert(list.map((r) => r.sale));
        const items = list.flatMap((r) => r.items), pays = list.flatMap((r) => r.payments);
        if (items.length) db.from("saleItem").insert(items);
        if (pays.length) db.from("payment").insert(pays);
        break;
      }
      case "returns": {
        const list = rows as { ret: Row; lines: Row[] }[];
        db.from("salesReturn").insert(list.map((r) => r.ret));
        const lines = list.flatMap((r) => r.lines);
        if (lines.length) db.from("salesReturnItem").insert(lines);
        break;
      }
      case "purchases": {
        const list = rows as { purchase: Row; items: Row[] }[];
        db.from("purchase").insert(list.map((r) => r.purchase));
        const items = list.flatMap((r) => r.items);
        if (items.length) db.from("purchaseItem").insert(items);
        break;
      }
      case "movements": db.from("stockMovement").insert(rows as Row[]); break;
      case "loyalty": db.from("loyaltyLedger").insert(rows as Row[]); break;
      case "money": {
        const list = rows as MoneyRow[];
        const of = (k: MoneyRow["kind"]) => list.filter((r) => r.kind === k).map((r) => r.row as Row);
        for (const [kind, table] of [["receipt", "customerReceipt"], ["payment", "supplierPayment"], ["expense", "expense"]] as const) { const r = of(kind); if (r.length) db.from(table).insert(r); }
        break;
      }
      default: throw new CounterError("Unknown part.");
    }
  });
  return rows.length;
}

/**
 * Step 3: opening balances and counter settings, then the checks. Only when every check passes does the device
 * become a working counter; the change history of the load is dropped (the first full copy to Drive holds it all).
 */
export function finishMove(db: DriveDB, base: MoveBase, userId: string, pilot?: PilotRows): MoveResult {
  if (!moveInProgress(db)) throw new CounterError("Start the move again.");
  if (db.getMeta("moveChecked") !== "1") {
    db.transaction(() => {
      if (base.opening.stock.length) db.from("stockMovement").insert(base.opening.stock);
      if (base.opening.receipts.length) db.from("customerReceipt").insert(base.opening.receipts);
      if (base.opening.supplierPayments.length) db.from("supplierPayment").insert(base.opening.supplierPayments);
      db.setMeta("moveChecked", "1");
    });
  }
  let result = verifyMove(db, base.summary);
  if (!result.ok) return result;
  // A pharmacy that ran the pilot: its records go on top, checked again. A failed merge leaves the move unfinished.
  if (pilot && db.getMeta("pilotMerged") !== "1") {
    const merged = mergePilot(db, pilot);
    result = { ok: merged.ok, checks: [...result.checks, ...merged.checks] };
    if (!merged.ok) return result;
    db.setMeta("pilotMerged", "1");
  }
  const series = seriesFor(db.device);
  if (!validSeries(series)) throw new CounterError("Couldn’t make a counter series for this device.");
  const s = base.settings;
  db.transaction(() => {
    db.setMeta("branchId", s.branch.id);
    db.setMeta("branchName", s.branch.name);
    db.setMeta("series", series);
    db.setMeta("maxDiscountPct", String(s.maxDiscountPct));
    db.setMeta("pharmacy", JSON.stringify(s.pharmacy));
    db.setMeta("loyalty", JSON.stringify(s.loyalty));
    db.setMeta("branches", JSON.stringify(s.branches));
    db.setMeta("users", JSON.stringify(s.users));
    db.setMeta("userId", userId);
    db.setMeta("userName", s.userName ?? "Owner");
    db.setMeta("movedFromMedoro", base.exportedAt);
    db.setMeta(IN_PROGRESS, "0");
    db.setMeta("moveChecked", "0");
  });
  const last = db.engine.all<{ seq: number }>("SELECT COALESCE(MAX(seq), 0) AS seq FROM changeLog")[0].seq;
  db.markPushed(Number(last));
  db.pruneChanges(db.clock.current);
  return result;
}

/** Compares this device's data with Medoro's summary: row counts, money totals, stock per batch, dues and points. */
export function verifyMove(db: DriveDB, summary: MoveBase["summary"]): MoveResult {
  const checks: MoveCheck[] = [];
  const one = (sql: string) => Number(db.engine.all<{ v: number }>(sql)[0]?.v ?? 0);
  for (const [table, expected] of Object.entries(summary.counts)) {
    const got = one(`SELECT COUNT(*) AS v FROM ${table.replace(/[^A-Za-z]/g, "")}`);
    checks.push({ name: `${table} records`, ok: got === expected, expected, got });
  }
  const totals: [string, number, string][] = [
    ["Sales total", summary.totals.salesPaise, "SELECT COALESCE(SUM(totalPaise), 0) AS v FROM sale"],
    ["Returns total", summary.totals.returnsPaise, "SELECT COALESCE(SUM(amountPaise), 0) AS v FROM salesReturn"],
    ["Purchases total", summary.totals.purchasesPaise, "SELECT COALESCE(SUM(totalPaise), 0) AS v FROM purchase"],
    ["Expenses total", summary.totals.expensesPaise, "SELECT COALESCE(SUM(amountPaise), 0) AS v FROM expense"],
  ];
  for (const [name, expected, sql] of totals) { const got = one(sql); checks.push({ name, ok: got === expected, expected, got }); }

  const compare = (name: string, want: Record<string, number>, have: Map<string, number>) => {
    const ids = new Set([...Object.keys(want), ...[...have].filter(([, v]) => v !== 0).map(([k]) => k)]);
    const bad = [...ids].filter((id) => (want[id] ?? 0) !== (have.get(id) ?? 0));
    checks.push({ name, ok: bad.length === 0, expected: ids.size, got: ids.size - bad.length, detail: bad.length ? `Differs for ${bad.slice(0, 5).join(", ")}${bad.length > 5 ? "…" : ""}` : undefined });
  };
  const grouped = (sql: string) => new Map(db.engine.all<{ id: string; v: number }>(sql).map((r) => [r.id, Number(r.v)]));
  compare("Stock of every batch", summary.stock, grouped("SELECT batchId AS id, SUM(qty) AS v FROM stockMovement GROUP BY batchId"));
  const custIds = db.engine.all<{ id: string }>("SELECT id FROM customer").map((r) => r.id);
  compare("Customer dues", summary.customerDues, new Map(custIds.map((id) => [id, customerBalance(db, id)])));
  compare("Supplier dues", summary.supplierDues, new Map(supplierDues(db).map((s) => [s.id, s.duePaise])));
  compare("Loyalty points", summary.points, grouped("SELECT customerId AS id, SUM(points) AS v FROM loyaltyLedger GROUP BY customerId"));
  return { ok: checks.every((c) => c.ok), checks };
}

// ---------- pharmacies that ran the Drive mode pilot ----------

/**
 * The pilot's own records, to add on top of Medoro's data during the move. The pilot started from a copy of Medoro's
 * catalogue, batches and customers (same ids) with each batch's stock as an "opening" movement; those openings are
 * left out, since Medoro's data already holds that stock (as are the openings of an earlier move that was undone: the
 * bills made on counters after it come across). Everything else the pilot recorded comes across: bills,
 * credit notes, payments, purchases, stock changes, points, orders, bank matching, consent, and medicines, batches,
 * customers and suppliers added on the pilot. A medicine or customer that is on both keeps Medoro's details.
 */
export type PilotRows = Partial<Record<TableName, Row[]>>;
export function pilotRows(pilot: DriveDB): PilotRows {
  const out: PilotRows = {};
  for (const t of Object.keys(TABLES) as TableName[]) {
    const rows = (pilot.engine.all<Record<string, string | number | null>>(`SELECT * FROM ${t}`) as Row[]).filter((r) => !copiedFromMedoro(t, r));
    if (rows.length) out[t] = rows;
  }
  return out;
}

/**
 * Rows Medoro made when it copied its data to a device: the pilot's starting stock, and the opening stock and balances
 * of an earlier move that was undone. Medoro's data holds those amounts already.
 */
function copiedFromMedoro(t: TableName, r: Row) {
  if (t === "stockMovement") return r.type === "opening" && (r.note === "Copied from Medoro" || r.note === "Opening stock, moved from Medoro");
  if (t === "customerReceipt" || t === "supplierPayment") return r.ref === "Opening balance, moved from Medoro";
  return false;
}

/** Tables in the order their rows can go in (each after the ones it points to). */
const MERGE_ORDER: TableName[] = ["medicine", "supplier", "customer", "batch",
  ...(Object.keys(TABLES) as TableName[]).filter((t) => !["medicine", "supplier", "customer", "batch"].includes(t))];
const BATCH_REFS: Partial<Record<TableName, string>> = { stockMovement: "batchId", saleItem: "batchId", purchaseItem: "batchId", salesReturnItem: "batchId" };

/**
 * Adds the pilot's records (pilotRows) to a device that holds Medoro's checked data, then checks that every pilot record
 * is there and that stock and totals equal Medoro's plus the pilot's. A pilot batch with the same number as one of
 * Medoro's (same branch and medicine) is the same physical batch: its movements go onto Medoro's batch. A pilot
 * purchase bill that Medoro also has stops the move with a clear message, since its stock would count twice.
 */
export function mergePilot(db: DriveDB, rows: PilotRows): MoveResult {
  const one = (sql: string) => Number(db.engine.all<{ v: number }>(sql)[0]?.v ?? 0);
  const stockBefore = new Map(db.engine.all<{ id: string; v: number }>("SELECT batchId AS id, SUM(qty) AS v FROM stockMovement GROUP BY batchId").map((r) => [r.id, Number(r.v)]));
  const totals: [string, TableName, string][] = [["Sales total", "sale", "totalPaise"], ["Returns total", "salesReturn", "amountPaise"], ["Purchases total", "purchase", "totalPaise"], ["Expenses total", "expense", "amountPaise"], ["Customer payments total", "customerReceipt", "amountPaise"], ["Supplier payments total", "supplierPayment", "amountPaise"]];
  const totalsBefore = new Map(totals.map(([name, t, col]) => [name, one(`SELECT COALESCE(SUM(${col}), 0) AS v FROM ${t}`)]));
  const exists = (t: TableName, id: unknown) => db.engine.all(`SELECT 1 FROM ${t} WHERE id = ?`, [id as string]).length > 0;
  const batchMap = new Map<string, string>();
  const added: Partial<Record<TableName, string[]>> = {};
  const problems: string[] = [];

  db.transaction(() => {
    for (const t of MERGE_ORDER) {
      const spec = TABLES[t];
      for (const raw of rows[t] ?? []) {
        if (exists(t, raw.id)) continue; // on Medoro too (a copied medicine, batch or customer): Medoro's details stand
        const row: Row = {};
        for (const c of spec.columns) if (c !== "updatedAt" && c !== "deletedAt" && c in raw) row[c] = raw[c];
        const ref = BATCH_REFS[t];
        if (ref && typeof row[ref] === "string" && batchMap.has(row[ref] as string)) row[ref] = batchMap.get(row[ref] as string)!;
        if (t === "batch") {
          const same = db.engine.all<{ id: string }>("SELECT id FROM batch WHERE branchId = ? AND medicineId = ? AND batchNo = ?", [row.branchId as string, row.medicineId as string, row.batchNo as string])[0];
          if (same) { batchMap.set(String(raw.id), same.id); continue; }
        }
        if (t === "purchase" && db.engine.all("SELECT 1 FROM purchase WHERE supplierId = ? AND billNo = ?", [row.supplierId as string, row.billNo as string]).length) {
          problems.push(`Supplier bill ${row.billNo} was entered both on Medoro and on the pilot counter`);
          continue;
        }
        db.from(t).insert(row);
        if (spec.kind === "mutable" && raw.deletedAt) db.from(t).withDeleted().eq("id", raw.id as string).delete();
        (added[t] ??= []).push(String(raw.id));
      }
    }
  });

  const checks: MoveCheck[] = [];
  if (problems.length) checks.push({ name: "Pilot records", ok: false, expected: problems.length, got: 0, detail: problems.slice(0, 3).join("; ") });
  // Every pilot record is here (copied master data counts as here; a merged batch counts as its Medoro batch).
  for (const t of MERGE_ORDER) {
    const want = (rows[t] ?? []).filter((r) => t !== "purchase" || !problems.some((p) => p.includes(` ${r.billNo} `))).map((r) => String(r.id));
    if (!want.length) continue;
    const got = want.filter((id) => exists(t, batchMap.get(id) ?? id)).length;
    checks.push({ name: `Pilot ${t} records`, ok: got === want.length, expected: want.length, got });
  }
  // Stock: Medoro's, plus every movement the pilot recorded (openings left out).
  const want = new Map(stockBefore);
  for (const m of rows.stockMovement ?? []) { const b = batchMap.get(String(m.batchId)) ?? String(m.batchId); want.set(b, (want.get(b) ?? 0) + Number(m.qty)); }
  const have = new Map(db.engine.all<{ id: string; v: number }>("SELECT batchId AS id, SUM(qty) AS v FROM stockMovement GROUP BY batchId").map((r) => [r.id, Number(r.v)]));
  const ids = new Set([...want.keys(), ...have.keys()]);
  const bad = [...ids].filter((id) => (want.get(id) ?? 0) !== (have.get(id) ?? 0));
  checks.push({ name: "Stock of every batch (Medoro + pilot)", ok: !bad.length, expected: ids.size, got: ids.size - bad.length, detail: bad.length ? `Differs for ${bad.slice(0, 5).join(", ")}` : undefined });
  for (const [name, t, col] of totals) {
    const expected = totalsBefore.get(name)! + (rows[t] ?? []).filter((r) => (added[t] ?? []).includes(String(r.id))).reduce((a, r) => a + Number(r[col] ?? 0), 0);
    const got = one(`SELECT COALESCE(SUM(${col}), 0) AS v FROM ${t}`);
    checks.push({ name: `${name} (Medoro + pilot)`, ok: got === expected, expected, got });
  }
  return { ok: checks.every((c) => c.ok), checks };
}
