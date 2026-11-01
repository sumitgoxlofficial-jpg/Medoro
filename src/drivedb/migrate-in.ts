/**
 * Phase 7: loads a pharmacy's full data from Medoro into this (empty) device database, then checks it against
 * the counts and totals Medoro computed. Ids are kept, so bills, returns and stock line up exactly.
 */
import type { DriveDB } from "./client";
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
    if (base.customers.length) db.from("customer").insert(base.customers.map((c) => ({ id: c.id, name: c.name, phone: c.phone, gstin: c.gstin, creditLimitPaise: c.creditLimitPaise })));
    const erased = base.customers.filter((c) => c.erased).map((c) => c.id);
    if (erased.length) db.from("customer").in("id", erased).delete();
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
export function finishMove(db: DriveDB, base: MoveBase, userId: string): MoveResult {
  if (!moveInProgress(db)) throw new CounterError("Start the move again.");
  if (db.getMeta("moveChecked") !== "1") {
    db.transaction(() => {
      if (base.opening.stock.length) db.from("stockMovement").insert(base.opening.stock);
      if (base.opening.receipts.length) db.from("customerReceipt").insert(base.opening.receipts);
      if (base.opening.supplierPayments.length) db.from("supplierPayment").insert(base.opening.supplierPayments);
      db.setMeta("moveChecked", "1");
    });
  }
  const result = verifyMove(db, base.summary);
  if (!result.ok) return result;
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
