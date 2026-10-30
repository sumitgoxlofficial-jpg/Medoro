import "server-only";
import { db } from "@/server/db";
import type { Ctx } from "@/server/context";
import { addDays, dateOnly, daysTo, isoOf, todayISO } from "@/lib/dates";
import { big } from "@/lib/money";
import { sellableByMedicine, velocity } from "@/domain/inventory/queries";
import { customerBalances, supplierBalances } from "@/domain/parties/balances";
import { inputGstByRate, outputGstByRate, trialBalance, type Period } from "./service";

export const REPORTS = [
  ["sales-register", "Sales register", "Invoices with tax split"],
  ["stock-valuation", "Stock valuation", "Batch-level at cost"],
  ["expiry-exposure", "Expiry exposure", "Batches expiring ≤ 180 days"],
  ["low-stock", "Low stock", "Below reorder level"],
  ["supplier-dues", "Supplier dues", "Payables & due dates"],
  ["customer-dues", "Customer dues", "Receivables"],
  ["gst-summary", "GST summary", "Output and input tax by slab"],
  ["day-book", "Day book", "All vouchers with ledger lines"],
  ["trial-balance", "Trial balance", "Account balances at period end"],
  ["stock-movements", "Stock movements", "Immutable stock ledger"],
] as const;
export type ReportId = (typeof REPORTS)[number][0];

/** Reports built from pharmacy-level balances and ledgers; the rest are per branch. */
export const PHARMACY_REPORTS: readonly ReportId[] = ["supplier-dues", "customer-dues", "day-book", "trial-balance"];
/** "branch": the current branch. "all": every branch the user can access. */
export type ReportScope = "branch" | "all";
export const scopeOf = (v: string | null | undefined): ReportScope => (v === "all" ? "all" : "branch");

/** Branches a report covers; null = the whole pharmacy. */
function reportBranches(ctx: Ctx, id: ReportId, scope: ReportScope) {
  if (PHARMACY_REPORTS.includes(id)) return null;
  return scope === "all" ? ctx.branches : ctx.branches.filter((b) => b.id === ctx.branchId);
}

/** File-name tag: the branch code, or "all" for pharmacy-wide or all-branch exports. */
export function reportScopeTag(ctx: Ctx, id: ReportId, scope: ReportScope) {
  const b = reportBranches(ctx, id, scope);
  return !b || b.length > 1 ? "all" : (b[0]?.code ?? ctx.branchCode).toLowerCase();
}

const r2 = (p: number) => (p / 100).toFixed(2);
const ist = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 16).replace("T", " ");

type Rows = (string | number | null)[][];

export async function reportRows(ctx: Ctx, id: ReportId, p: Period, scope: ReportScope = "branch"): Promise<Rows> {
  const branches = reportBranches(ctx, id, scope);
  if (!branches) return pharmacyRows(ctx, id, p);
  if (id === "gst-summary") return gstSummary(ctx.tenantId, p, branches.map((b) => b.id));
  if (branches.length === 1) return branchRows(ctx, id, p, branches[0].id);
  // Several branches: one block per branch with a leading Branch column.
  const parts = await Promise.all(branches.map(async (b) => ({ b, rows: await branchRows(ctx, id, p, b.id) })));
  return [["Branch", ...(parts[0]?.rows[0] ?? [])], ...parts.flatMap(({ b, rows }) => rows.slice(1).map((r) => [b.name, ...r]))];
}

async function gstSummary(T: string, p: Period, branchIds: string[]): Promise<Rows> {
  const [out, inn] = await Promise.all([outputGstByRate(T, p, branchIds), inputGstByRate(T, p, branchIds)]);
  const rates = [...new Set([...out.map((x) => x.rate), ...inn.map((x) => x.rate)])].sort((a, b) => a - b);
  const half = (n: number) => [r2(Math.floor(n / 2)), r2(n - Math.floor(n / 2))];
  // Retail sales are intra-state, so output IGST is zero; the column keeps the layout GSTR-ready.
  return [["Slab %", "Sales taxable", "Credit notes taxable", "Output taxable (net)", "Output CGST", "Output SGST", "Output IGST", "Purchases taxable", "Debit notes taxable", "Input taxable (net)", "Input CGST", "Input SGST", "Input IGST"],
    ...rates.map((r) => { const o = out.find((x) => x.rate === r), i = inn.find((x) => x.rate === r);
      return [r, r2(o?.grossTaxable ?? 0), r2(o?.retTaxable ?? 0), r2(o?.taxable ?? 0), ...half(o?.tax ?? 0), r2(0), r2(i?.grossTaxable ?? 0), r2(i?.retTaxable ?? 0), r2(i?.taxable ?? 0), r2(i?.cgst ?? 0), r2(i?.sgst ?? 0), r2(i?.igst ?? 0)]; })];
}

async function pharmacyRows(ctx: Ctx, id: ReportId, p: Period): Promise<Rows> {
  const T = ctx.tenantId;
  switch (id) {
    case "supplier-dues": {
      const [sup, bal, bills] = await Promise.all([db.supplier.findMany({ where: { tenantId: T }, orderBy: { name: "asc" } }), supplierBalances(db, T), db.supplierBill.findMany({ where: { tenantId: T }, orderBy: { dueDate: "asc" } })]);
      return [["Supplier", "GSTIN", "Balance", "Next due date", "Next due amount"],
        ...sup.map((x) => { const o = bills.find((b) => b.supplierId === x.id && b.paidPaise < b.amountPaise); return [x.name, x.gstin, r2(bal.get(x.id) ?? 0), o ? isoOf(o.dueDate) : "", o ? r2(big(o.amountPaise) - big(o.paidPaise)) : ""]; })];
    }
    case "customer-dues": {
      const [c, bal] = await Promise.all([db.customer.findMany({ where: { tenantId: T, erasedAt: null }, orderBy: { name: "asc" } }), customerBalances(db, T)]);
      return [["Customer", "Phone", "Outstanding", "Credit limit"], ...c.filter((x) => (bal.get(x.id) ?? 0) !== 0 || big(x.creditLimitPaise) > 0).map((x) => [x.name, x.phone, r2(bal.get(x.id) ?? 0), r2(big(x.creditLimitPaise))])];
    }
    case "day-book": {
      const v = await db.voucher.findMany({ where: { tenantId: T, date: { gte: p.from, lt: p.to } }, include: { lines: true }, orderBy: [{ date: "asc" }, { no: "asc" }] });
      return [["Voucher", "Date", "Type", "Narration", "Account", "Debit", "Credit"], ...v.flatMap((x) => x.lines.map((l) => [x.no, ist(x.date), x.type, x.narration, l.account, r2(big(l.debitPaise)), r2(big(l.creditPaise))]))];
    }
    case "trial-balance": {
      const tb = await trialBalance(ctx, addDays(p.toDay, -1));
      return [["Account", "Debit", "Credit"], ...tb.rows.map((r) => [r.account, r2(r.dr), r2(r.cr)]), ["Total", r2(tb.dr), r2(tb.cr)]];
    }
    default:
      throw new Error(`${id} is a branch report.`);
  }
}

async function branchRows(ctx: Ctx, id: ReportId, p: Period, B: string): Promise<Rows> {
  const T = ctx.tenantId;
  switch (id) {
    case "sales-register": {
      const s = await db.sale.findMany({ where: { tenantId: T, branchId: B, at: { gte: p.from, lt: p.to } }, include: { customer: { select: { name: true } } }, orderBy: { at: "asc" } });
      return [["Invoice", "Date", "Customer", "MRP total", "Discount", "Taxable", "CGST", "SGST", "Round off", "Total", "Mode", "Prescriber"],
        ...s.map((x) => [x.invoiceNo, ist(x.at), x.customer?.name ?? "Walk-in", r2(big(x.subtotalPaise)), r2(big(x.discountPaise)), r2(big(x.taxablePaise)), r2(big(x.cgstPaise)), r2(big(x.sgstPaise)), r2(big(x.roundOffPaise)), r2(big(x.totalPaise)), x.payMode, x.prescriber])];
    }
    case "stock-valuation": {
      const b = await db.batch.findMany({ where: { tenantId: T, branchId: B, qtyAvailable: { gt: 0 } }, include: { medicine: true }, orderBy: [{ medicine: { name: "asc" } }, { expiryDate: "asc" }] });
      return [["Medicine", "Strength", "Batch", "Expiry", "Qty", "Cost/pack", "MRP/pack", "Value at cost", "Status"],
        ...b.map((x) => [x.medicine.name, x.medicine.strength, x.batchNo, isoOf(x.expiryDate), x.qtyAvailable, r2(big(x.costPaise)), r2(big(x.mrpPaise)), r2(x.qtyAvailable * big(x.costPaise)), x.status])];
    }
    case "expiry-exposure": {
      const [b, vel] = await Promise.all([
        db.batch.findMany({ where: { tenantId: T, branchId: B, qtyAvailable: { gt: 0 }, expiryDate: { lte: dateOnly(addDays(todayISO(), 180)) } }, include: { medicine: true }, orderBy: { expiryDate: "asc" } }),
        velocity(T, B),
      ]);
      return [["Medicine", "Batch", "Expiry", "Days left", "Qty", "Exposure at cost", "Projected unsold", "Projected loss at cost"],
        ...b.map((x) => { const d = daysTo(x.expiryDate), sold = Math.min(x.qtyAvailable, Math.floor((vel.get(x.medicineId) ?? 0) * Math.max(0, d))), left = x.qtyAvailable - sold;
          return [x.medicine.name, x.batchNo, isoOf(x.expiryDate), d, x.qtyAvailable, r2(x.qtyAvailable * big(x.costPaise)), left, r2(left * big(x.costPaise))]; })];
    }
    case "low-stock": {
      const [m, s, v] = await Promise.all([db.medicine.findMany({ where: { tenantId: T, active: true }, orderBy: { name: "asc" } }), sellableByMedicine(T, B), velocity(T, B)]);
      return [["Medicine", "Strength", "Sellable", "Reorder level", "Sales/day (28d)", "Days cover"],
        ...m.filter((x) => (s.get(x.id) ?? 0) < x.reorderLevel).map((x) => { const st = s.get(x.id) ?? 0, vel = v.get(x.id) ?? 0; return [x.name, x.strength, st, x.reorderLevel, vel.toFixed(2), vel ? Math.floor(st / vel) : ""]; })];
    }
    case "stock-movements": {
      const m = await db.stockMovement.findMany({ where: { tenantId: T, branchId: B, at: { gte: p.from, lt: p.to } }, include: { batch: { include: { medicine: { select: { name: true } } } } }, orderBy: { at: "asc" } });
      const users = await db.user.findMany({ where: { tenantId: T }, select: { id: true, name: true } });
      return [["Time", "Medicine", "Batch", "Type", "Qty", "Reference", "By"], ...m.map((x) => [ist(x.at), x.batch.medicine.name, x.batch.batchNo, x.type, x.qty, x.note ?? x.refType, users.find((u) => u.id === x.userId)?.name ?? ""])];
    }
    default:
      throw new Error(`${id} is a pharmacy report.`);
  }
}
