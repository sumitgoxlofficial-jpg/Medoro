import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { authorizeView, type Ctx } from "@/server/context";
import { big } from "@/lib/money";
import { stockValue } from "@/lib/units";
import { todayISO } from "@/lib/dates";
import { ACC } from "@/domain/accounting/accounts";
import { customerIntel } from "@/domain/sales/customer-intel";
import type { Period } from "./profit";
import { growthPct, periodDays, previousPeriod, rank, ratioPct, turnover } from "./benchmark-rules";
import { istMidnight, addDays } from "@/lib/dates";

/**
 * Chain benchmarking across the branches THIS user may access (ctx.branches), never others. Figures come from the ledger
 * (net sales), sale lines (cost), stock on hand, write-offs and the customer-intelligence retention series. Definitions
 * and their limits are in benchmark-rules.ts. A one-branch pharmacy gets the figures without ranks.
 */
export type Employee = { userId: string; name: string; bills: number; netSalesPaise: number; avgBasketPaise: number | null; discountPct: number | null; voids: number; returns: number };
export type BranchBench = {
  branchId: string; branch: string;
  salesPaise: number; prevSalesPaise: number; growthPct: number | null;
  grossMarginPct: number | null; stockTurnover: number | null; stockAtCostPaise: number;
  expiryLossPct: number | null; writeOffPaise: number;
  stockoutPct: number | null; stockouts: number; tracked: number;
  retentionPct: number | null;
  ranks: { growth: number | null; margin: number | null; turnover: number | null; expiryLoss: number | null; stockout: number | null; retention: number | null };
  employees: Employee[];
};
export type Benchmark = { period: Period; previous: { fromDay: string; toDay: string }; branches: BranchBench[]; ranked: boolean };

async function ledgerSales(tenantId: string, ids: string[], from: Date, to: Date) {
  const rows = await db.$queryRaw<{ branchId: string; account: string; dr: bigint; cr: bigint }[]>`
    SELECT v."branchId", l.account, SUM(l."debitPaise")::bigint dr, SUM(l."creditPaise")::bigint cr FROM "LedgerLine" l JOIN "Voucher" v ON v.id = l."voucherId"
    WHERE v."tenantId" = ${tenantId} AND v."branchId" = ANY(${ids}::text[]) AND v.date >= ${from} AND v.date < ${to} AND l.account IN (${ACC.sales}, ${ACC.salesReturns}) GROUP BY 1, 2`;
  return new Map(ids.map((b) => {
    const g = (a: string) => { const r = rows.find((x) => x.branchId === b && x.account === a); return r ? { dr: big(r.dr), cr: big(r.cr) } : { dr: 0, cr: 0 }; };
    const s = g(ACC.sales), r = g(ACC.salesReturns);
    return [b, s.cr - s.dr - (r.dr - r.cr)];
  }));
}

export async function benchmark(ctx: Ctx, period: Period, now = new Date()): Promise<Benchmark> {
  authorizeView(ctx, "reports");
  const ids = ctx.branches.map((b) => b.id), days = periodDays(period.fromDay, period.toDay), prev = previousPeriod(period.fromDay, period.toDay);
  const { from, to } = period, pFrom = istMidnight(prev.fromDay), pTo = istMidnight(addDays(prev.toDay, 1)), today = todayISO(now);
  const sqlIds = Prisma.sql`${ids}::text[]`;
  const [cur, before, cogs, batches, items, wo, emp, voids, rets] = await Promise.all([
    ledgerSales(ctx.tenantId, ids, from, to), ledgerSales(ctx.tenantId, ids, pFrom, pTo),
    db.$queryRaw<{ branchId: string; cost: bigint }[]>`SELECT s."branchId", SUM(si."costPaise" * (si.qty - si."returnedQty"))::bigint cost FROM "SaleItem" si JOIN "Sale" s ON s.id = si."saleId" WHERE s."tenantId" = ${ctx.tenantId} AND s."branchId" = ANY(${sqlIds}) AND s.at >= ${from} AND s.at < ${to} AND si.qty > 0 GROUP BY 1`,
    db.batch.findMany({ where: { tenantId: ctx.tenantId, branchId: { in: ids }, qtyAvailable: { gt: 0 } }, select: { branchId: true, medicineId: true, qtyAvailable: true, costPaise: true, status: true, expiryDate: true, medicine: { select: { packSize: true } } } }),
    db.medicine.findMany({ where: { tenantId: ctx.tenantId, active: true, reorderLevel: { gt: 0 } }, select: { id: true } }),
    db.$queryRaw<{ branchId: string; v: bigint | null }[]>`SELECT "branchId", SUM("valuePaise")::bigint v FROM "StockOut" WHERE "tenantId" = ${ctx.tenantId} AND "branchId" = ANY(${sqlIds}) AND kind = 'write_off' AND at >= ${from} AND at < ${to} GROUP BY 1`,
    db.$queryRaw<{ branchId: string; userId: string; bills: bigint; net: bigint; disc: bigint; gross: bigint }[]>`
      SELECT s."branchId", s."userId", COUNT(*)::bigint bills, SUM(s."taxablePaise")::bigint net, SUM(s."discountPaise")::bigint disc, SUM(s."subtotalPaise")::bigint gross FROM "Sale" s
      WHERE s."tenantId" = ${ctx.tenantId} AND s."branchId" = ANY(${sqlIds}) AND s.at >= ${from} AND s.at < ${to} AND NOT EXISTS (SELECT 1 FROM "SaleVoid" v WHERE v."saleId" = s.id) GROUP BY 1, 2`,
    db.$queryRaw<{ branchId: string; userId: string; c: bigint }[]>`SELECT "branchId", "userId", COUNT(*)::bigint c FROM "SaleVoid" WHERE "tenantId" = ${ctx.tenantId} AND "branchId" = ANY(${sqlIds}) AND at >= ${from} AND at < ${to} GROUP BY 1, 2`,
    db.$queryRaw<{ branchId: string; userId: string; c: bigint }[]>`SELECT "branchId", "userId", COUNT(*)::bigint c FROM "SalesReturn" WHERE "tenantId" = ${ctx.tenantId} AND "branchId" = ANY(${sqlIds}) AND at >= ${from} AND at < ${to} GROUP BY 1, 2`,
  ]);
  const users = await db.user.findMany({ where: { tenantId: ctx.tenantId, id: { in: [...new Set([...emp, ...voids, ...rets].map((x) => x.userId))] } }, select: { id: true, name: true } });
  const retention = new Map<string, number | null>();
  for (const b of ids) {
    const r = (await customerIntel(ctx, b, now)).retention.map((x) => x.rate).filter((x): x is number => x != null);
    retention.set(b, r.length ? Math.round((r.reduce((a, c) => a + c, 0) / r.length) * 10) / 10 : null);
  }
  const rows: BranchBench[] = ctx.branches.map((br) => {
    const sales = cur.get(br.id) ?? 0, psales = before.get(br.id) ?? 0, cost = big(cogs.find((c) => c.branchId === br.id)?.cost ?? 0n);
    const mine = batches.filter((b) => b.branchId === br.id);
    const stock = mine.reduce((a, b) => a + stockValue(big(b.costPaise), b.qtyAvailable, b.medicine.packSize), 0);
    const sellable = new Set(mine.filter((b) => b.status === "ok" && b.expiryDate.toISOString().slice(0, 10) >= today).map((b) => b.medicineId));
    const out = items.filter((i) => !sellable.has(i.id)).length, written = big(wo.find((w) => w.branchId === br.id)?.v ?? 0n);
    const employees: Employee[] = emp.filter((e) => e.branchId === br.id).map((e) => ({
      userId: e.userId, name: users.find((u) => u.id === e.userId)?.name ?? "Unknown", bills: Number(e.bills), netSalesPaise: big(e.net), avgBasketPaise: Number(e.bills) ? Math.round(big(e.net) / Number(e.bills)) : null,
      discountPct: ratioPct(big(e.disc), big(e.gross)), voids: Number(voids.find((v) => v.branchId === br.id && v.userId === e.userId)?.c ?? 0), returns: Number(rets.find((v) => v.branchId === br.id && v.userId === e.userId)?.c ?? 0),
    })).sort((a, b) => b.netSalesPaise - a.netSalesPaise);
    return {
      branchId: br.id, branch: br.name, salesPaise: sales, prevSalesPaise: psales, growthPct: growthPct(sales, psales),
      grossMarginPct: sales > 0 ? ratioPct(sales - cost, sales) : null, stockTurnover: turnover(cost, days, stock), stockAtCostPaise: stock,
      expiryLossPct: ratioPct(written, sales), writeOffPaise: written, stockoutPct: ratioPct(out, items.length), stockouts: out, tracked: items.length, retentionPct: retention.get(br.id) ?? null,
      ranks: { growth: null, margin: null, turnover: null, expiryLoss: null, stockout: null, retention: null }, employees,
    };
  });
  const r = { growth: rank(rows.map((x) => x.growthPct), "high"), margin: rank(rows.map((x) => x.grossMarginPct), "high"), turnover: rank(rows.map((x) => x.stockTurnover), "high"), expiryLoss: rank(rows.map((x) => x.expiryLossPct), "low"), stockout: rank(rows.map((x) => x.stockoutPct), "low"), retention: rank(rows.map((x) => x.retentionPct), "high") };
  rows.forEach((x, i) => { x.ranks = { growth: r.growth[i], margin: r.margin[i], turnover: r.turnover[i], expiryLoss: r.expiryLoss[i], stockout: r.stockout[i], retention: r.retention[i] }; });
  return { period, previous: { fromDay: prev.fromDay, toDay: prev.toDay }, branches: rows, ranked: rows.length > 1 };
}
