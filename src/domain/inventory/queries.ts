import "server-only";
import { db } from "@/server/db";
import { dateOnly, todayISO } from "@/lib/dates";

/** Sellable units per medicine in a branch: status ok, not expired, qty > 0. */
export async function sellableByMedicine(tenantId: string, branchId: string): Promise<Map<string, number>> {
  const rows = await db.batch.groupBy({
    by: ["medicineId"],
    where: { tenantId, branchId, status: "ok", qtyAvailable: { gt: 0 }, expiryDate: { gt: dateOnly(todayISO()) } },
    _sum: { qtyAvailable: true },
  });
  return new Map(rows.map((r) => [r.medicineId, r._sum.qtyAvailable ?? 0]));
}

/** Average units sold per day over the last `days` days, per medicine, in a branch. */
export async function velocity(tenantId: string, branchId: string, days = 28): Promise<Map<string, number>> {
  const since = new Date(Date.now() - days * 86400_000);
  const rows = await db.$queryRaw<{ medicineId: string; q: bigint }[]>`
    SELECT si."medicineId", SUM(si.qty - si."returnedQty") AS q
    FROM "SaleItem" si JOIN "Sale" s ON s.id = si."saleId"
    WHERE s."tenantId" = ${tenantId} AND s."branchId" = ${branchId} AND s.at >= ${since}
    GROUP BY si."medicineId"`;
  return new Map(rows.map((r) => [r.medicineId, Number(r.q) / days]));
}
