/**
 * The owner's dashboard for a Drive mode pharmacy, from this device's own database (Medoro's server has none of
 * these records). Same figures as Medoro's server dashboard: sales, margin, purchases, expenses, what customers owe
 * and what is owed to suppliers, the last 14 days of sales, low stock and stock expiring within 90 days.
 */
import type { DriveDB } from "./client";
import { stockOf } from "./pharmacy";
import { customerBalance } from "./trade";
import { expiringStock, salesByDay, supplierDues } from "./books";
import { dayReport } from "./reports";
import { addDays, istMidnight, todayISO } from "@/lib/dates";

export type DashRange = "today" | "7d" | "30d";
const n = (v: unknown) => Number(v ?? 0);

export function dashboard(db: DriveDB, branchId: string, range: DashRange = "today", today = todayISO()) {
  const from = range === "today" ? today : addDays(today, range === "7d" ? -6 : -29);
  const days = salesByDay(db, branchId, addDays(today, -29), today);
  const inRange = days.filter((d) => d.date >= from);
  const sum = (k: "bills" | "salesPaise" | "taxPaise" | "costPaise" | "returnsPaise" | "profitPaise", rows = inRange) => rows.reduce((a, d) => a + d[k], 0);
  const net = sum("salesPaise") - sum("taxPaise") - sum("returnsPaise");
  // Margin compared with the 7 days before the range, as on the server dashboard.
  const prev = days.filter((d) => d.date < from && d.date >= addDays(from, -7));
  const prevNet = sum("salesPaise", prev) - sum("taxPaise", prev) - sum("returnsPaise", prev);
  const margin = net > 0 ? sum("profitPaise") / net : null, prevMargin = prevNet > 0 ? sum("profitPaise", prev) / prevNet : null;

  const [lo, hi] = [istMidnight(from).toISOString(), istMidnight(addDays(today, 1)).toISOString()];
  const purchases = db.engine.all<{ count: number; total: number }>("SELECT COUNT(*) AS count, COALESCE(SUM(totalPaise), 0) AS total FROM purchase WHERE branchId = ? AND at >= ? AND at < ?", [branchId, lo, hi])[0];
  const expenses = db.engine.all<{ count: number; total: number }>("SELECT COUNT(*) AS count, COALESCE(SUM(amountPaise), 0) AS total FROM expense WHERE branchId = ? AND at >= ? AND at < ?", [branchId, lo, hi])[0];

  const owing = db.engine.all<{ id: string; name: string }>("SELECT id, name FROM customer WHERE deletedAt IS NULL")
    .map((c) => ({ ...c, due: customerBalance(db, c.id) })).filter((c) => c.due > 0);
  const dues = supplierDues(db).filter((s) => s.duePaise > 0);

  const low = db.engine.all<{ id: string; name: string; reorderLevel: number; packSize: number }>(
    "SELECT id, name, reorderLevel, packSize FROM medicine WHERE deletedAt IS NULL AND active = 1 AND reorderLevel > 0 ORDER BY name COLLATE NOCASE")
    .map((m) => ({ id: m.id, name: m.name, stock: stockOf(db, m.id, branchId, today), reorder: n(m.reorderLevel) * Math.max(1, n(m.packSize)) }))
    .filter((m) => m.stock <= m.reorder);
  const expiring = expiringStock(db, branchId, 90, today);
  const day = dayReport(db, branchId, today);

  const chart = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13)).map((d) => ({ date: d, salesPaise: days.find((x) => x.date === d)?.salesPaise ?? 0 }));
  return {
    range, from, today,
    sales: { paise: sum("salesPaise"), bills: sum("bills") },
    margin: { pct: margin, prevPct: prevMargin },
    purchases: { paise: n(purchases.total), count: n(purchases.count) },
    expenses: { paise: n(expenses.total), count: n(expenses.count) },
    receivables: { paise: owing.reduce((a, c) => a + c.due, 0), customers: owing.length },
    payables: { paise: dues.reduce((a, s) => a + s.duePaise, 0), suppliers: dues.length },
    chart,
    collections: day.byMode,
    lowStock: low.slice(0, 8), lowCount: low.length,
    expiring: expiring.slice(0, 8), expiringCount: expiring.length, expiringValuePaise: expiring.reduce((a, e) => a + e.valuePaise, 0),
  };
}
export type Dashboard = ReturnType<typeof dashboard>;
