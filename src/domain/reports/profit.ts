import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { authorizeView, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { big } from "@/lib/money";
import { stockValue } from "@/lib/units";
import { addDays, istMidnight, todayISO } from "@/lib/dates";
import { ACC, EXPENSE_ACCOUNTS } from "@/domain/accounting/accounts";
import { scopeBranches } from "@/domain/purchasing/supplier-intel";
import { salesMargins, type MarginRow } from "./margins";
import { costVariation, flagDiscounts, pct, reconcile, type CostVariation, type Recon } from "./profit-rules";

/**
 * Profit intelligence. Net sales come from the ledger (Sales less sales returns; voids are reversal entries) and are
 * reconciled against the sale lines; cost of goods is the landed cost carried on each sale line; indirect costs are ledger
 * debits to expense accounts. See profit-rules.ts for the definitions. Vouchers with no branch (pharmacy-wide) are not
 * attributed to any branch and are left out here. Nothing is estimated from MRP.
 */
export const COST_WINDOW_DAYS = 180;
const INDIRECT = [...EXPENSE_ACCOUNTS, ACC.loyalty, ACC.stockLoss, ACC.claimLoss, ACC.cashDiff, ACC.roundOff] as string[];

export type Period = { fromDay: string; toDay: string; from: Date; to: Date };
export function profitPeriod(fromDay: string | undefined, toDay: string | undefined, now = new Date()): Period {
  const ok = (s?: string) => !!s && /^\d{4}-\d{2}-\d{2}$/.test(s);
  const t = ok(toDay) ? toDay! : todayISO(now), f = ok(fromDay) ? fromDay! : addDays(t, -29);
  if (f > t) throw new UserError("The start date is after the end date.");
  if ((Date.parse(t) - Date.parse(f)) / 86400_000 > 366) throw new UserError("Choose a period of at most one year.");
  return { fromDay: f, toDay: t, from: istMidnight(f), to: istMidnight(addDays(t, 1)) };
}

export type BranchProfit = { branchId: string; branch: string; itemSales: number; cogs: number; ledgerSales: number; grossProfit: number; grossPct: number | null; indirect: number; netProfit: number; discountPaise: number; discountPct: number | null; recon: Recon };
export type ProfitIntel = {
  scope: { branchId: string | null; branchName: string }; period: Period;
  branches: BranchProfit[]; total: BranchProfit;
  byItem: MarginRow[]; byCategory: MarginRow[]; bySupplier: MarginRow[];
  discounts: { overallPct: number | null; cashiers: { userId: string; name: string; bills: number; discountPaise: number; ratePct: number | null; flagged: boolean }[] };
  leakage: {
    belowCost: { medicineId: string; name: string; qty: number; lossPaise: number }[]; belowCostTotal: number;
    writeOffs: { totalPaise: number; count: number; byReason: { reason: string; count: number; valuePaise: number }[] };
    damagedReturns: { count: number; refundPaise: number };
    expiredInStockPaise: number;
  };
  freeGoods: { supplier: string; freeUnits: number; paidUnits: number; freeValuePaise: number; paidValuePaise: number; freeSharePct: number | null }[];
  costVariation: { medicineId: string; name: string; v: CostVariation }[];
};

export async function profitIntel(ctx: Ctx, branchId: string | null, period: Period, now = new Date()): Promise<ProfitIntel> {
  authorizeView(ctx, "reports");
  const sc = scopeBranches(ctx, branchId), ids = sc.ids, { from, to } = period, today = todayISO(now);
  const sqlIds = Prisma.sql`${ids}::text[]`;
  const [items, ledger, disc, belowCost, wo, woReasons, dmg, free, costRows, expired, byItem, byCategory, bySupplier] = await Promise.all([
    db.$queryRaw<{ branchId: string; sales: number; cost: bigint }[]>`
      SELECT s."branchId", ROUND(SUM(si."taxablePaise"::numeric * (si.qty - si."returnedQty") / si.qty))::float8 sales, SUM(si."costPaise" * (si.qty - si."returnedQty"))::bigint cost
      FROM "SaleItem" si JOIN "Sale" s ON s.id = si."saleId"
      WHERE s."tenantId" = ${ctx.tenantId} AND s."branchId" = ANY(${sqlIds}) AND s.at >= ${from} AND s.at < ${to} AND si.qty > 0 GROUP BY 1`,
    db.$queryRaw<{ branchId: string; account: string; dr: bigint; cr: bigint }[]>`
      SELECT v."branchId", l.account, SUM(l."debitPaise")::bigint dr, SUM(l."creditPaise")::bigint cr FROM "LedgerLine" l JOIN "Voucher" v ON v.id = l."voucherId"
      WHERE v."tenantId" = ${ctx.tenantId} AND v."branchId" = ANY(${sqlIds}) AND v.date >= ${from} AND v.date < ${to} AND l.account = ANY(${[ACC.sales, ACC.salesReturns, ...INDIRECT]}::text[]) GROUP BY 1, 2`,
    db.$queryRaw<{ branchId: string; userId: string; bills: bigint; disc: bigint; gross: bigint }[]>`
      SELECT s."branchId", s."userId", COUNT(*)::bigint bills, SUM(s."discountPaise")::bigint disc, SUM(s."subtotalPaise")::bigint gross FROM "Sale" s
      WHERE s."tenantId" = ${ctx.tenantId} AND s."branchId" = ANY(${sqlIds}) AND s.at >= ${from} AND s.at < ${to} AND NOT EXISTS (SELECT 1 FROM "SaleVoid" v WHERE v."saleId" = s.id) GROUP BY 1, 2`,
    db.$queryRaw<{ id: string; name: string; qty: bigint; loss: number }[]>`
      SELECT m.id, MIN(m.name || ' ' || m.strength) name, SUM(si.qty - si."returnedQty")::bigint qty,
        SUM(GREATEST(0, si."costPaise"::numeric * (si.qty - si."returnedQty") - si."taxablePaise"::numeric * (si.qty - si."returnedQty") / si.qty))::float8 loss
      FROM "SaleItem" si JOIN "Sale" s ON s.id = si."saleId" JOIN "Medicine" m ON m.id = si."medicineId"
      WHERE s."tenantId" = ${ctx.tenantId} AND s."branchId" = ANY(${sqlIds}) AND s.at >= ${from} AND s.at < ${to} AND si.qty > 0 AND si.qty > si."returnedQty"
      GROUP BY m.id HAVING SUM(GREATEST(0, si."costPaise"::numeric * (si.qty - si."returnedQty") - si."taxablePaise"::numeric * (si.qty - si."returnedQty") / si.qty)) > 0 ORDER BY loss DESC LIMIT 20`,
    db.$queryRaw<{ c: bigint; v: bigint | null }[]>`SELECT COUNT(*)::bigint c, SUM("valuePaise")::bigint v FROM "StockOut" WHERE "tenantId" = ${ctx.tenantId} AND "branchId" = ANY(${sqlIds}) AND kind = 'write_off' AND at >= ${from} AND at < ${to}`,
    db.$queryRaw<{ reason: string; c: bigint; v: bigint }[]>`SELECT lower(trim(reason)) reason, COUNT(*)::bigint c, SUM("valuePaise")::bigint v FROM "StockOut" WHERE "tenantId" = ${ctx.tenantId} AND "branchId" = ANY(${sqlIds}) AND kind = 'write_off' AND at >= ${from} AND at < ${to} GROUP BY 1 ORDER BY v DESC LIMIT 8`,
    db.$queryRaw<{ c: bigint; v: bigint | null }[]>`SELECT COUNT(*)::bigint c, SUM("amountPaise")::bigint v FROM "SalesReturn" WHERE "tenantId" = ${ctx.tenantId} AND "branchId" = ANY(${sqlIds}) AND condition = 'damaged' AND at >= ${from} AND at < ${to}`,
    db.$queryRaw<{ supplierId: string; free: bigint; paid: bigint; fv: bigint; pv: bigint }[]>`
      SELECT g."supplierId", SUM(gi."freeQty")::bigint free, SUM(gi.qty)::bigint paid, SUM(gi."freeQty" * gi."ratePaise")::bigint fv, SUM(gi.qty * gi."ratePaise")::bigint pv
      FROM "GrnItem" gi JOIN "Grn" g ON g.id = gi."grnId" WHERE g."tenantId" = ${ctx.tenantId} AND g."branchId" = ANY(${sqlIds}) AND g."approvedAt" >= ${from} AND g."approvedAt" < ${to} GROUP BY 1 HAVING SUM(gi."freeQty") > 0`,
    db.$queryRaw<{ medicineId: string; cost: bigint }[]>`
      SELECT gi."medicineId", gi."costPaise" cost FROM "GrnItem" gi JOIN "Grn" g ON g.id = gi."grnId"
      WHERE g."tenantId" = ${ctx.tenantId} AND g."branchId" = ANY(${sqlIds}) AND gi."costPaise" > 0 AND g."approvedAt" >= ${new Date(now.getTime() - COST_WINDOW_DAYS * 86400_000)} ORDER BY g."approvedAt" ASC`,
    db.batch.findMany({ where: { tenantId: ctx.tenantId, branchId: { in: ids }, qtyAvailable: { gt: 0 }, expiryDate: { lt: new Date(today + "T00:00:00.000Z") } }, select: { costPaise: true, qtyAvailable: true, medicine: { select: { packSize: true } } } }),
    salesMargins(ctx, from, to, "item", ids), salesMargins(ctx, from, to, "category", ids), salesMargins(ctx, from, to, "supplier", ids),
  ]);

  const branchName = new Map(ctx.branches.map((b) => [b.id, b.name]));
  const led = (b: string, a: string) => { const r = ledger.find((x) => x.branchId === b && x.account === a); return r ? { dr: big(r.dr), cr: big(r.cr) } : { dr: 0, cr: 0 }; };
  const rows: BranchProfit[] = ids.map((b) => {
    const it = items.find((x) => x.branchId === b), itemSales = Number(it?.sales ?? 0), cogs = big(it?.cost ?? 0n);
    const s = led(b, ACC.sales), r = led(b, ACC.salesReturns);
    const ledgerSales = s.cr - s.dr - (r.dr - r.cr);
    const indirect = INDIRECT.reduce((a, acc) => { const l = led(b, acc); return a + (l.dr - l.cr); }, 0);
    const d = disc.filter((x) => x.branchId === b), dTot = d.reduce((a, x) => a + big(x.disc), 0), gTot = d.reduce((a, x) => a + big(x.gross), 0);
    // Profit is stated on the ledger's net sales: that is the figure the books carry; the difference to the sale lines is shown.
    return { branchId: b, branch: branchName.get(b) ?? "", itemSales, cogs, ledgerSales, grossProfit: ledgerSales - cogs, grossPct: pct(ledgerSales - cogs, ledgerSales), indirect, netProfit: ledgerSales - cogs - indirect, discountPaise: dTot, discountPct: pct(dTot, gTot), recon: reconcile(itemSales, ledgerSales) };
  });
  const sum = (k: "itemSales" | "cogs" | "ledgerSales" | "indirect" | "discountPaise") => rows.reduce((a, r) => a + r[k], 0);
  const grossAll = disc.reduce((a, x) => a + big(x.gross), 0), ledgerAll = sum("ledgerSales");
  const total: BranchProfit = { branchId: "", branch: "Total", itemSales: sum("itemSales"), cogs: sum("cogs"), ledgerSales: ledgerAll, grossProfit: ledgerAll - sum("cogs"), grossPct: pct(ledgerAll - sum("cogs"), ledgerAll), indirect: sum("indirect"), netProfit: ledgerAll - sum("cogs") - sum("indirect"), discountPaise: sum("discountPaise"), discountPct: pct(sum("discountPaise"), grossAll), recon: reconcile(sum("itemSales"), ledgerAll) };

  const users = await db.user.findMany({ where: { tenantId: ctx.tenantId, id: { in: [...new Set(disc.map((x) => x.userId))] } }, select: { id: true, name: true } });
  const perUser = new Map<string, { userId: string; bills: number; discountPaise: number; grossPaise: number }>();
  for (const x of disc) { const u = perUser.get(x.userId) ?? { userId: x.userId, bills: 0, discountPaise: 0, grossPaise: 0 }; u.bills += Number(x.bills); u.discountPaise += big(x.disc); u.grossPaise += big(x.gross); perUser.set(x.userId, u); }
  const fd = flagDiscounts([...perUser.values()]);

  const sups = await db.supplier.findMany({ where: { tenantId: ctx.tenantId, id: { in: free.map((f) => f.supplierId) } }, select: { id: true, name: true } });
  const byMed = new Map<string, number[]>();
  for (const r of costRows) byMed.set(r.medicineId, [...(byMed.get(r.medicineId) ?? []), big(r.cost)]);
  const flagged = [...byMed.entries()].map(([id, c]) => ({ id, v: costVariation(c) })).filter((x): x is { id: string; v: CostVariation } => !!x.v && x.v.flagged).sort((a, b) => b.v.spreadPct - a.v.spreadPct).slice(0, 15);
  const meds = await db.medicine.findMany({ where: { id: { in: flagged.map((f) => f.id) } }, select: { id: true, name: true, strength: true } });

  return {
    scope: { branchId: sc.id, branchName: sc.name }, period, branches: rows, total, byItem: byItem.slice(0, 25), byCategory, bySupplier,
    discounts: { overallPct: fd.overallPct, cashiers: fd.rows.map((r) => ({ userId: r.userId, name: users.find((u) => u.id === r.userId)?.name ?? "Unknown", bills: r.bills, discountPaise: r.discountPaise, ratePct: r.ratePct, flagged: r.flagged })).sort((a, b) => (b.ratePct ?? 0) - (a.ratePct ?? 0)) },
    leakage: {
      belowCost: belowCost.map((r) => ({ medicineId: r.id, name: r.name, qty: Number(r.qty), lossPaise: Math.round(r.loss) })), belowCostTotal: belowCost.reduce((a, r) => a + Math.round(r.loss), 0),
      writeOffs: { totalPaise: big(wo[0]?.v ?? 0n), count: Number(wo[0]?.c ?? 0), byReason: woReasons.map((r) => ({ reason: r.reason, count: Number(r.c), valuePaise: big(r.v) })) },
      damagedReturns: { count: Number(dmg[0]?.c ?? 0), refundPaise: big(dmg[0]?.v ?? 0n) },
      expiredInStockPaise: expired.reduce((a, b) => a + stockValue(big(b.costPaise), b.qtyAvailable, b.medicine.packSize), 0),
    },
    freeGoods: free.map((f) => ({ supplier: sups.find((s) => s.id === f.supplierId)?.name ?? "", freeUnits: Number(f.free), paidUnits: Number(f.paid), freeValuePaise: big(f.fv), paidValuePaise: big(f.pv), freeSharePct: pct(Number(f.free), Number(f.free) + Number(f.paid)) })).sort((a, b) => b.freeValuePaise - a.freeValuePaise),
    costVariation: flagged.map((f) => ({ medicineId: f.id, name: (() => { const m = meds.find((x) => x.id === f.id); return m ? `${m.name} ${m.strength}`.trim() : ""; })(), v: f.v })),
  };
}
