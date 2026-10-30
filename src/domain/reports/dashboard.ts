import "server-only";
import { db } from "@/server/db";
import { addDays, dateOnly, daysTo, hhmm, dayMonth, startOfTodayIST, todayISO } from "@/lib/dates";
import { big } from "@/lib/money";
import { fmtQty, stockValue } from "@/lib/units";
import { sellableByMedicine, velocity } from "@/domain/inventory/queries";
import { ACC } from "@/domain/accounting/accounts";
import { backupHealth } from "./alerts";

export type Range = "today" | "7d" | "30d";
const DAY = 86400_000;

async function salesIn(tenantId: string, branchId: string, from: Date, to: Date) {
  const r = await db.sale.aggregate({
    where: { tenantId, branchId, at: { gte: from, lt: to }, voided: { is: null } },
    _sum: { totalPaise: true, taxablePaise: true, costPaise: true }, _count: true,
  });
  const ret = await db.salesReturn.aggregate({ where: { tenantId, branchId, at: { gte: from, lt: to } }, _sum: { amountPaise: true } });
  return { total: big(r._sum.totalPaise), taxable: big(r._sum.taxablePaise), cost: big(r._sum.costPaise), bills: r._count, returns: big(ret._sum.amountPaise) };
}

export async function dashboard(tenantId: string, branchId: string, range: Range, branchIds: string[]) {
  const now = new Date();
  const today0 = startOfTodayIST(now);
  const days = range === "today" ? 1 : range === "7d" ? 7 : 30;
  const from = new Date(today0.getTime() - (days - 1) * DAY);
  const elapsed = now.getTime() - today0.getTime();

  const [cur, prev, last7] = await Promise.all([
    salesIn(tenantId, branchId, from, now),
    // Compare with the previous period up to the same time of day.
    salesIn(tenantId, branchId, new Date(from.getTime() - days * DAY), new Date(from.getTime() - days * DAY + (days - 1) * DAY + elapsed)),
    salesIn(tenantId, branchId, new Date(today0.getTime() - 7 * DAY), today0),
  ]);
  const margin = cur.taxable ? ((cur.taxable - cur.cost) / cur.taxable) * 100 : null;
  const margin7 = last7.taxable ? ((last7.taxable - last7.cost) / last7.taxable) * 100 : null;

  const [grns, expenses, reversals, debtors, creditors, dueBills, payRows] = await Promise.all([
    db.grn.aggregate({ where: { tenantId, branchId, approvedAt: { gte: from } }, _sum: { totalPaise: true }, _count: true }),
    db.voucher.findMany({ where: { tenantId, branchId, refType: "expense", date: { gte: from } }, include: { lines: true } }),
    db.voucher.findMany({ where: { tenantId, branchId, refType: "reversal", date: { gte: from } }, include: { lines: true } }),
    db.$queryRaw<{ id: string; bal: bigint }[]>`SELECT "partyId" AS id, SUM("debitPaise" - "creditPaise") AS bal FROM "LedgerLine" l JOIN "Voucher" v ON v.id = l."voucherId" WHERE v."tenantId" = ${tenantId} AND l.account = ${ACC.debtors} GROUP BY "partyId"`,
    db.$queryRaw<{ bal: bigint }[]>`SELECT COALESCE(SUM("creditPaise" - "debitPaise"), 0) AS bal FROM "LedgerLine" l JOIN "Voucher" v ON v.id = l."voucherId" WHERE v."tenantId" = ${tenantId} AND l.account = ${ACC.creditors}`,
    db.supplierBill.findMany({ where: { tenantId, dueDate: { lte: dateOnly(addDays(todayISO(), 7)) } } }),
    db.$queryRaw<{ mode: string; amt: bigint }[]>`SELECT p.mode::text AS mode, SUM(p."amountPaise") AS amt FROM "Payment" p JOIN "Sale" s ON s.id = p."saleId" WHERE s."tenantId" = ${tenantId} AND s."branchId" = ${branchId} AND s.at >= ${from} AND NOT EXISTS (SELECT 1 FROM "SaleVoid" sv WHERE sv."saleId" = s.id) GROUP BY p.mode`,
  ]);
  // Reversals are dated when posted (like the P&L), so they net off in the period they were made.
  const reversedIds = reversals.map((r) => r.reversesId).filter((x): x is string => !!x);
  const expenseIds = new Set((await db.voucher.findMany({ where: { tenantId, id: { in: reversedIds }, refType: "expense" }, select: { id: true } })).map((v) => v.id));
  const expenseReversals = reversals.filter((r) => r.reversesId && expenseIds.has(r.reversesId));
  const expenseTotal = expenses.reduce((a, v) => a + v.lines.reduce((b, l) => b + big(l.debitPaise), 0), 0) - expenseReversals.reduce((a, v) => a + v.lines.reduce((b, l) => b + big(l.creditPaise), 0), 0);
  const expenseCount = expenses.filter((v) => !expenseIds.has(v.id)).length;
  const receivable = debtors.reduce((a, r) => a + Math.max(0, Number(r.bal)), 0);
  const onCredit = debtors.filter((r) => Number(r.bal) > 0).length;
  const payable = Number(creditors[0]?.bal ?? 0);
  const dueWeek = dueBills.reduce((a, b) => a + big(b.amountPaise) - big(b.paidPaise), 0);

  // 14-day history (always daily, ending today)
  const histFrom = new Date(today0.getTime() - 13 * DAY);
  const hist = await db.$queryRaw<{ d: string; t: bigint }[]>`
    SELECT to_char((at AT TIME ZONE 'Asia/Kolkata')::date, 'YYYY-MM-DD') AS d, SUM("totalPaise") AS t
    FROM "Sale" s WHERE "tenantId" = ${tenantId} AND "branchId" = ${branchId} AND at >= ${histFrom} AND NOT EXISTS (SELECT 1 FROM "SaleVoid" sv WHERE sv."saleId" = s.id) GROUP BY 1`;
  const hmap = new Map(hist.map((h) => [h.d, Number(h.t)]));
  const history = Array.from({ length: 14 }, (_, i) => { const d = addDays(todayISO(), i - 13); return { date: d, total: hmap.get(d) ?? 0 }; });

  // Stock
  const [meds, sellable, vel, batches] = await Promise.all([
    db.medicine.findMany({ where: { tenantId, active: true }, select: { id: true, name: true, reorderLevel: true } }),
    sellableByMedicine(tenantId, branchId),
    velocity(tenantId, branchId),
    db.batch.findMany({
      where: { tenantId, branchId, qtyAvailable: { gt: 0 }, expiryDate: { gt: dateOnly(todayISO()), lte: dateOnly(addDays(todayISO(), 90)) } },
      include: { medicine: { select: { name: true, packSize: true, packUnit: true, looseUnit: true } } }, orderBy: { expiryDate: "asc" },
    }),
  ]);
  const lowStock = meds.map((m) => ({ ...m, stock: sellable.get(m.id) ?? 0, vel: vel.get(m.id) ?? 0 }))
    .filter((m) => m.reorderLevel > 0 && m.stock < m.reorderLevel)
    .sort((a, b) => a.stock / a.reorderLevel - b.stock / b.reorderLevel)
    .map((m) => ({ id: m.id, name: m.name, stock: m.stock, reorder: m.reorderLevel, coverDays: m.vel > 0 ? Math.floor(m.stock / m.vel) : null }));
  const expiring = batches.map((b) => ({ id: b.id, name: b.medicine.name, batchNo: b.batchNo, qty: b.qtyAvailable, qtyText: fmtQty(b.qtyAvailable, b.medicine), days: daysTo(b.expiryDate), value: stockValue(big(b.costPaise), b.qtyAvailable, b.medicine.packSize), status: b.status }));

  // Insights: only what the data supports, each with its basis.
  const insights: { title: string; body: string; basis: string; href: string; cta: string }[] = [];
  const ex60 = expiring.filter((e) => e.days <= 60 && e.status === "ok");
  if (ex60.length) {
    const exposure = ex60.reduce((a, e) => a + e.value, 0);
    let loss = 0;
    for (const e of ex60) { const b = batches.find((x) => x.id === e.id)!; const v = vel.get(b.medicineId) ?? 0; loss += Math.max(0, e.qty - Math.floor(v * e.days)) * big(b.costPaise); }
    insights.push({ title: `${fmtInr(exposure)} of stock expires within 60 days`, body: `${ex60.length} batch${ex60.length > 1 ? "es" : ""} at risk. At current sell rates, about ${fmtInr(loss)} (cost) would go unsold.`, basis: "Batch expiry dates, 28-day average sales", href: "/app/expiry", cta: "Review batches" });
  }
  const runout = meds.map((m) => ({ m, s: sellable.get(m.id) ?? 0, v: vel.get(m.id) ?? 0 })).filter((x) => x.v >= 0.5 && x.s / x.v < 14).sort((a, b) => a.s / a.v - b.s / b.v)[0];
  if (runout) insights.push({ title: `${runout.m.name} runs out in ~${Math.floor(runout.s / runout.v)} days`, body: `${runout.s} left, selling ${runout.v.toFixed(1)} a day.`, basis: "28-day sales velocity", href: "#ai:Prepare a purchase order for review", cta: "Draft a PO with AI" });

  // Branch performance (period)
  const brs = await db.branch.findMany({ where: { tenantId, active: true, id: { in: branchIds } }, orderBy: { createdAt: "asc" } });
  const perf = await db.sale.groupBy({ by: ["branchId"], where: { tenantId, branchId: { in: branchIds }, at: { gte: from }, voided: { is: null } }, _sum: { totalPaise: true }, _count: true });
  const branchPerf = brs.map((b) => { const p = perf.find((x) => x.branchId === b.id); return { name: b.name, total: big(p?._sum.totalPaise), bills: p?._count ?? 0 }; });

  const [lastBackup, activity] = await Promise.all([
    db.backupManifest.findFirst({ where: { tenantId, status: "verified" }, orderBy: { startedAt: "desc" } }),
    db.auditEvent.findMany({ where: { tenantId }, orderBy: { id: "desc" }, take: 6 }),
  ]);
  const drive = await db.integration.findUnique({ where: { tenantId_kind: { tenantId, kind: "gdrive" } } });
  const backupProblems = await backupHealth(tenantId);

  const pay = { cash: 0, upi: 0, card: 0, credit: 0 } as Record<string, number>;
  for (const r of payRows) pay[r.mode] = (pay[r.mode] ?? 0) + Number(r.amt);

  return {
    range, catalogueSize: meds.length,
    kpi: {
      sales: cur.total - cur.returns, bills: cur.bills, salesPrev: prev.total - prev.returns,
      margin, margin7, purchases: big(grns._sum.totalPaise), grnCount: grns._count,
      expenses: expenseTotal, expenseCount, receivable, onCredit, payable, dueWeek,
    },
    history, pay, lowStock, expiring, insights, branchPerf,
    backup: { last: lastBackup ? dayMonth(lastBackup.startedAt, true) + " · " + hhmm(lastBackup.startedAt) : null, driveConnected: !!drive?.connectedAt, problems: backupProblems },
    activity: activity.map((a) => ({ id: String(a.id), when: dayMonth(a.at) + " " + hhmm(a.at), who: a.userName ?? "System", action: a.action, detail: a.detail })),
  };
}

const fmtInr = (p: number) => "₹" + Math.round(p / 100).toLocaleString("en-IN");
export type DashboardData = Awaited<ReturnType<typeof dashboard>>;
