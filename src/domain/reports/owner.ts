import "server-only";
import { db } from "@/server/db";
import { authorizeView, type Ctx } from "@/server/context";
import { addDays, dateOnly, dayMonth, hhmm, startOfTodayIST, todayISO } from "@/lib/dates";
import { big } from "@/lib/money";
import { sellableByMedicine } from "@/domain/inventory/queries";
import { expected } from "@/domain/sales/returns";
import { badgesAndAlerts } from "./alerts";

const DAY = 86400_000;

/** The owner's phone view: today against yesterday at the same time, drawers, stock risks, approvals, backup. */
export async function ownerSnapshot(ctx: Ctx, now = new Date()) {
  authorizeView(ctx, "reports");
  const T = ctx.tenantId, ids = ctx.branches.map((b) => b.id);
  const t0 = startOfTodayIST(now), y0 = new Date(t0.getTime() - DAY), ySame = new Date(now.getTime() - DAY);
  const in30 = dateOnly(addDays(todayISO(now), 30)), today = dateOnly(todayISO(now));
  const sales = (from: Date, to: Date) => db.sale.groupBy({ by: ["branchId"], where: { tenantId: T, branchId: { in: ids }, at: { gte: from, lt: to }, voided: { is: null } }, _sum: { totalPaise: true }, _count: true });
  const rets = (from: Date, to: Date) => db.salesReturn.groupBy({ by: ["branchId"], where: { tenantId: T, branchId: { in: ids }, at: { gte: from, lt: to } }, _sum: { amountPaise: true } });
  const [sT, sY, rT, rY, payRows, shifts, meds, exp, transfers, conflicts, drafts, newOrders, outOrders, codOut, approvals, lastBackup, lastOk, drive, alerts] = await Promise.all([
    sales(t0, now), sales(y0, ySame), rets(t0, now), rets(y0, ySame),
    db.$queryRaw<{ mode: string; amt: bigint }[]>`SELECT p.mode::text AS mode, SUM(p."amountPaise") AS amt FROM "Payment" p JOIN "Sale" s ON s.id = p."saleId" WHERE s."tenantId" = ${T} AND s."branchId" = ANY(${ids}::text[]) AND s.at >= ${t0} AND NOT EXISTS (SELECT 1 FROM "SaleVoid" sv WHERE sv."saleId" = s.id) GROUP BY p.mode`,
    db.shift.findMany({ where: { tenantId: T, branchId: { in: ids }, closedAt: null }, orderBy: { openedAt: "asc" } }),
    db.medicine.findMany({ where: { tenantId: T, active: true, reorderLevel: { gt: 0 } }, select: { id: true, reorderLevel: true } }),
    db.batch.groupBy({ by: ["branchId"], where: { tenantId: T, branchId: { in: ids }, qtyAvailable: { gt: 0 }, status: "ok", expiryDate: { gt: today, lte: in30 } }, _count: true }),
    db.transfer.count({ where: { tenantId: T, status: "pending", OR: [{ fromBranch: { in: ids } }, { toBranch: { in: ids } }] } }),
    db.offlineOp.count({ where: { tenantId: T, status: "conflict" } }),
    db.purchaseOrder.count({ where: { tenantId: T, branchId: { in: ids }, status: "draft" } }),
    db.deliveryOrder.count({ where: { tenantId: T, branchId: { in: ids }, status: "new" } }),
    db.deliveryOrder.count({ where: { tenantId: T, branchId: { in: ids }, status: "out_for_delivery" } }),
    db.deliveryOrder.aggregate({ where: { tenantId: T, branchId: { in: ids }, status: "delivered", collectedMode: "cash", settlementId: null }, _sum: { collectedPaise: true } }),
    db.discountApproval.count({ where: { tenantId: T, branchId: { in: ids }, createdAt: { gte: t0 } } }),
    db.backupManifest.findFirst({ where: { tenantId: T }, orderBy: { startedAt: "desc" } }),
    db.backupManifest.findFirst({ where: { tenantId: T, status: "verified" }, orderBy: { startedAt: "desc" } }),
    db.integration.findUnique({ where: { tenantId_kind: { tenantId: T, kind: "gdrive" } }, select: { connectedAt: true } }),
    badgesAndAlerts(T, ctx.branchId),
  ]);
  const low = await Promise.all(ids.map(async (b) => { const s = await sellableByMedicine(T, b); return [b, meds.filter((m) => (s.get(m.id) ?? 0) < m.reorderLevel).length] as const; }));
  const net = (s: typeof sT, r: typeof rT, b: string) => big(s.find((x) => x.branchId === b)?._sum.totalPaise) - big(r.find((x) => x.branchId === b)?._sum.amountPaise);
  const branches = ctx.branches.map((b) => ({
    id: b.id, name: b.name, today: net(sT, rT, b.id), yesterday: net(sY, rY, b.id), bills: sT.find((x) => x.branchId === b.id)?._count ?? 0,
    low: low.find(([x]) => x === b.id)?.[1] ?? 0, expiring: exp.find((x) => x.branchId === b.id)?._count ?? 0,
  }));
  const users = await db.user.findMany({ where: { tenantId: T, id: { in: shifts.flatMap((s) => [s.openedBy, s.userId ?? ""]) } }, select: { id: true, name: true } });
  const counters = await db.counter.findMany({ where: { tenantId: T, id: { in: shifts.map((s) => s.counter) } }, select: { id: true, name: true } });
  const drawers = await Promise.all(shifts.map(async (s) => ({
    id: s.id, branch: ctx.branches.find((b) => b.id === s.branchId)?.name ?? "", counter: counters.find((c) => c.id === s.counter)?.name ?? "Browser counter",
    by: users.find((u) => u.id === (s.userId ?? s.openedBy))?.name ?? "", since: hhmm(s.openedAt), cash: (await expected(s)).expected,
  })));
  const pay: Record<string, number> = {};
  for (const r of payRows) pay[r.mode] = Number(r.amt);
  const age = lastOk ? Math.floor((now.getTime() - lastOk.startedAt.getTime()) / 3600_000) : null;
  return {
    asOf: hhmm(now), day: dayMonth(now, true),
    total: { today: branches.reduce((a, b) => a + b.today, 0), yesterday: branches.reduce((a, b) => a + b.yesterday, 0), bills: branches.reduce((a, b) => a + b.bills, 0) },
    branches, pay, drawers,
    stock: { low: branches.reduce((a, b) => a + b.low, 0), expiring: branches.reduce((a, b) => a + b.expiring, 0) },
    pending: { transfers, conflicts, drafts, newOrders, outOrders, codWithRiders: big(codOut._sum.collectedPaise), discountApprovals: approvals },
    backup: {
      last: lastBackup ? { status: lastBackup.status, at: dayMonth(lastBackup.startedAt) + " " + hhmm(lastBackup.startedAt), error: lastBackup.error } : null,
      lastOk: lastOk ? dayMonth(lastOk.startedAt) + " " + hhmm(lastOk.startedAt) : null, hoursSinceOk: age, drive: !!drive?.connectedAt,
      healthy: age != null && age <= 36 && lastBackup?.status !== "failed",
    },
    alerts: alerts.alerts,
  };
}
export type OwnerSnapshot = Awaited<ReturnType<typeof ownerSnapshot>>;
