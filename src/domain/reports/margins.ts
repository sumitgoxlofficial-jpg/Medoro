import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { authorizeView, type Ctx } from "@/server/context";
import { big } from "@/lib/money";
import { stockValue } from "@/lib/units";
import { exGst, marginPct } from "@/domain/purchasing/pricing";

export type MarginBy = "item" | "category" | "supplier";
export type MarginRow = { key: string; name: string; qty: number; sales: number; cost: number; margin: number; pct: number | null };

/**
 * Realised margin on sales between two instants: selling value excluding GST, net of returned units, against the
 * landed cost carried on each sale line (batch cost after schemes, discounts and free goods). Category is the dosage
 * form; supplier is the one on the batch sold.
 */
export async function salesMargins(ctx: Ctx, from: Date, to: Date, by: MarginBy, branchIds: string[] = [ctx.branchId]): Promise<MarginRow[]> {
  authorizeView(ctx, "reports");
  const key = by === "item" ? Prisma.sql`m.id` : by === "category" ? Prisma.sql`m.form` : Prisma.sql`COALESCE(b."supplierId", '')`;
  const label = by === "item" ? Prisma.sql`MIN(m.name || ' ' || m.strength)` : by === "category" ? Prisma.sql`m.form` : Prisma.sql`COALESCE(MIN(sp.name), 'No supplier (opening stock)')`;
  const rows = await db.$queryRaw<{ key: string; name: string; qty: bigint; sales: number; cost: bigint }[]>`
    SELECT ${key} AS key, ${label} AS name, SUM(si.qty - si."returnedQty")::bigint qty,
      ROUND(SUM(si."taxablePaise"::numeric * (si.qty - si."returnedQty") / si.qty))::float8 sales, SUM(si."costPaise" * (si.qty - si."returnedQty"))::bigint cost
    FROM "SaleItem" si JOIN "Sale" s ON s.id = si."saleId" JOIN "Medicine" m ON m.id = si."medicineId" JOIN "Batch" b ON b.id = si."batchId" LEFT JOIN "Supplier" sp ON sp.id = b."supplierId"
    WHERE s."tenantId" = ${ctx.tenantId} AND s."branchId" = ANY(${branchIds}::text[]) AND s.at >= ${from} AND s.at < ${to} AND si.qty > 0
    GROUP BY ${key}`;
  return rows.map((r) => { const sales = Number(r.sales), cost = big(r.cost); return { key: r.key, name: r.name, qty: Number(r.qty), sales, cost, margin: sales - cost, pct: marginPct(sales, cost) }; })
    .filter((r) => r.qty > 0).sort((a, b) => b.margin - a.margin);
}

/** Margin on stock in hand: MRP excluding GST against each batch's landed cost. */
export async function stockMargins(ctx: Ctx) {
  authorizeView(ctx, "reports");
  const batches = await db.batch.findMany({ where: { tenantId: ctx.tenantId, branchId: ctx.branchId, qtyAvailable: { gt: 0 } }, include: { medicine: { select: { id: true, name: true, strength: true, gstRate: true, packSize: true } } } });
  const by = new Map<string, { name: string; qty: number; sell: number; cost: number }>();
  for (const b of batches) {
    const x = by.get(b.medicineId) ?? { name: `${b.medicine.name} ${b.medicine.strength}`, qty: 0, sell: 0, cost: 0 };
    // Stock is in stock units; MRP and cost are per pack.
    const ps = b.medicine.packSize;
    x.qty += b.qtyAvailable; x.sell += stockValue(exGst(big(b.mrpPaise), b.medicine.gstRate), b.qtyAvailable, ps); x.cost += stockValue(big(b.costPaise), b.qtyAvailable, ps);
    by.set(b.medicineId, x);
  }
  return [...by.entries()].map(([id, x]) => ({ id, ...x, margin: x.sell - x.cost, pct: marginPct(x.sell, x.cost) })).sort((a, b) => (a.pct ?? 0) - (b.pct ?? 0));
}
