import "server-only";
import { db } from "@/server/db";
import { dateOnly, todayISO } from "@/lib/dates";

/**
 * Sellable whole packs per medicine in a branch: status ok, not expired, qty > 0. Batches hold stock units,
 * so medicines sold loose are divided by their pack size (a part-strip doesn't count as a pack).
 */
export async function sellableByMedicine(tenantId: string, branchId: string): Promise<Map<string, number>> {
  const rows = await db.$queryRaw<{ medicineId: string; q: number }[]>`
    SELECT b."medicineId", FLOOR(SUM(b."qtyAvailable")::numeric / MAX(m."packSize"))::int AS q
    FROM "Batch" b JOIN "Medicine" m ON m.id = b."medicineId"
    WHERE b."tenantId" = ${tenantId} AND b."branchId" = ${branchId} AND b.status = 'ok' AND b."qtyAvailable" > 0 AND b."expiryDate" > ${dateOnly(todayISO())}
    GROUP BY b."medicineId"`;
  return new Map(rows.map((r) => [r.medicineId, Number(r.q)]));
}

/** Average packs sold per day over the last `days` days, per medicine, in a branch (loose units count as part-packs). */
export async function velocity(tenantId: string, branchId: string, days = 28): Promise<Map<string, number>> {
  const since = new Date(Date.now() - days * 86400_000);
  const rows = await db.$queryRaw<{ medicineId: string; q: number }[]>`
    SELECT si."medicineId", SUM((si.qty - si."returnedQty")::float8 / CASE WHEN si.loose THEN si."packSize" ELSE 1 END) AS q
    FROM "SaleItem" si JOIN "Sale" s ON s.id = si."saleId"
    WHERE s."tenantId" = ${tenantId} AND s."branchId" = ${branchId} AND s.at >= ${since}
    GROUP BY si."medicineId"`;
  return new Map(rows.map((r) => [r.medicineId, Number(r.q) / days]));
}
