import "server-only";
import { db } from "@/server/db";
import type { Ctx } from "@/server/context";
import { addDays, dateOnly, daysTo, isoOf, todayISO } from "@/lib/dates";
import { big } from "@/lib/money";
import { sellableByMedicine, velocity } from "@/domain/inventory/queries";
import { customerBalances, supplierBalances } from "@/domain/parties/balances";
import type { Period } from "./service";

export const REPORTS = [
  ["sales-register", "Sales register", "Invoices with tax split"],
  ["stock-valuation", "Stock valuation", "Batch-level at cost"],
  ["expiry-exposure", "Expiry exposure", "Batches expiring ≤ 180 days"],
  ["low-stock", "Low stock", "Below reorder level"],
  ["supplier-dues", "Supplier dues", "Payables & due dates"],
  ["customer-dues", "Customer dues", "Receivables"],
  ["gst-summary", "GST summary", "Output and input tax by slab"],
  ["day-book", "Day book", "All vouchers with ledger lines"],
  ["stock-movements", "Stock movements", "Immutable stock ledger"],
] as const;
export type ReportId = (typeof REPORTS)[number][0];

const r2 = (p: number) => (p / 100).toFixed(2);
const ist = (d: Date) => new Date(d.getTime() + 330 * 60_000).toISOString().slice(0, 16).replace("T", " ");

export async function reportRows(ctx: Ctx, id: ReportId, p: Period): Promise<(string | number | null)[][]> {
  const T = ctx.tenantId, B = ctx.branchId;
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
    case "supplier-dues": {
      const [sup, bal, bills] = await Promise.all([db.supplier.findMany({ where: { tenantId: T }, orderBy: { name: "asc" } }), supplierBalances(db, T), db.supplierBill.findMany({ where: { tenantId: T }, orderBy: { dueDate: "asc" } })]);
      return [["Supplier", "GSTIN", "Balance", "Next due date", "Next due amount"],
        ...sup.map((x) => { const o = bills.find((b) => b.supplierId === x.id && b.paidPaise < b.amountPaise); return [x.name, x.gstin, r2(bal.get(x.id) ?? 0), o ? isoOf(o.dueDate) : "", o ? r2(big(o.amountPaise) - big(o.paidPaise)) : ""]; })];
    }
    case "customer-dues": {
      const [c, bal] = await Promise.all([db.customer.findMany({ where: { tenantId: T, erasedAt: null }, orderBy: { name: "asc" } }), customerBalances(db, T)]);
      return [["Customer", "Phone", "Outstanding", "Credit limit"], ...c.filter((x) => (bal.get(x.id) ?? 0) !== 0 || big(x.creditLimitPaise) > 0).map((x) => [x.name, x.phone, r2(bal.get(x.id) ?? 0), r2(big(x.creditLimitPaise))])];
    }
    case "gst-summary": {
      const out = await db.$queryRaw<{ rate: number; taxable: bigint; tax: bigint }[]>`SELECT si."gstRate" rate, SUM(si."taxablePaise") taxable, SUM(si."mrpPaise"*si.qty - si."discountPaise" - si."taxablePaise") tax FROM "SaleItem" si JOIN "Sale" s ON s.id = si."saleId" WHERE s."tenantId" = ${T} AND s.at >= ${p.from} AND s.at < ${p.to} GROUP BY 1 ORDER BY 1`;
      const inn = await db.$queryRaw<{ rate: number; taxable: bigint }[]>`SELECT gi."gstRate" rate, SUM(gi."ratePaise"*gi.qty) taxable FROM "GrnItem" gi JOIN "Grn" g ON g.id = gi."grnId" WHERE g."tenantId" = ${T} AND g."invoiceDate" >= ${p.fromDay}::date AND g."invoiceDate" < ${p.toDay}::date GROUP BY 1 ORDER BY 1`;
      const rates = [...new Set([...out.map((x) => x.rate), ...inn.map((x) => x.rate)])].sort((a, b) => a - b);
      return [["Slab %", "Output taxable", "Output CGST", "Output SGST", "Input taxable", "Input CGST", "Input SGST"],
        ...rates.map((r) => { const o = out.find((x) => x.rate === r), i = inn.find((x) => x.rate === r); const ot = Number(o?.tax ?? 0), it = Math.round((Number(i?.taxable ?? 0) * r) / 100);
          return [r, r2(Number(o?.taxable ?? 0)), r2(Math.floor(ot / 2)), r2(ot - Math.floor(ot / 2)), r2(Number(i?.taxable ?? 0)), r2(Math.floor(it / 2)), r2(it - Math.floor(it / 2))]; })];
    }
    case "day-book": {
      const v = await db.voucher.findMany({ where: { tenantId: T, date: { gte: p.from, lt: p.to } }, include: { lines: true }, orderBy: [{ date: "asc" }, { no: "asc" }] });
      return [["Voucher", "Date", "Type", "Narration", "Account", "Debit", "Credit"], ...v.flatMap((x) => x.lines.map((l) => [x.no, ist(x.date), x.type, x.narration, l.account, r2(big(l.debitPaise)), r2(big(l.creditPaise))]))];
    }
    case "stock-movements": {
      const m = await db.stockMovement.findMany({ where: { tenantId: T, branchId: B, at: { gte: p.from, lt: p.to } }, include: { batch: { include: { medicine: { select: { name: true } } } } }, orderBy: { at: "asc" } });
      const users = await db.user.findMany({ where: { tenantId: T }, select: { id: true, name: true } });
      return [["Time", "Medicine", "Batch", "Type", "Qty", "Reference", "By"], ...m.map((x) => [ist(x.at), x.batch.medicine.name, x.batch.batchNo, x.type, x.qty, x.note ?? x.refType, users.find((u) => u.id === x.userId)?.name ?? ""])];
    }
  }
}
