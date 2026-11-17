import "server-only";
import { db } from "@/server/db";
import { authorize, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { supplierPerformance } from "./service";
import { recommend, scoreSupplier, type Quote, type Ranked, type Recommendation, type Score, type SupplierFacts } from "./supplier-score";

/**
 * Supplier intelligence over the pharmacy's own purchase history.
 *
 * Landed cost is the GRN line's `costPaise`: per stock unit, after scheme/trade/cash discounts, spread over free goods,
 * plus GST only where it can't be claimed as input credit (docs/PURCHASING.md). Lines posted before that field existed
 * have no landed cost and are left out rather than guessed. Credit terms are a separate factor: they are not netted
 * into the cost. Everything is scoped to the branches this user can access.
 */
export const QUOTE_WINDOW_DAYS = 180;
const DAY = 86400_000;

export type SupplierRow = {
  id: string; name: string; score: Score; orders: number; fillPct: number | null; onTimePct: number | null; creditDays: number; leadDays: number;
  acceptsReturns: boolean; returnWindowDays: number; comparedMedicines: number; priceIndexPct: number | null; priceChange180Pct: number | null;
};
export type MedicineRec = { medicineId: string; medicine: string; rec: Recommendation; quotes: { supplier: string; landedPaise: number; at: string }[] };
export type PricePoint = { at: string; landedPaise: number };
export type SupplierIntel = {
  scope: { branchId: string | null; branchName: string; branchIds: string[] };
  suppliers: SupplierRow[]; recommendations: MedicineRec[];
  byBranch: { branchId: string; branch: string; top: { name: string; score: number }[] }[];
  /** Lines left out because they predate landed-cost recording. */
  linesWithoutLandedCost: number;
};

/** The branches to evaluate: one the user can access, or all of them. */
export function scopeBranches(ctx: Ctx, branchId: string | null) {
  if (!branchId) return { ids: ctx.branches.map((b) => b.id), name: "All my branches", id: null as string | null };
  const b = ctx.branches.find((x) => x.id === branchId);
  if (!b) throw new UserError("You don’t have access to that branch.");
  return { ids: [b.id], name: b.name, id: b.id as string | null };
}

type Line = { medicineId: string; supplierId: string; cost: bigint; at: Date };

async function lines(tenantId: string, branchIds: string[], since: Date): Promise<{ rows: Line[]; missing: number }> {
  const [rows, missing] = await Promise.all([
    db.$queryRaw<Line[]>`
      SELECT gi."medicineId", g."supplierId", gi."costPaise" cost, g."approvedAt" at
      FROM "GrnItem" gi JOIN "Grn" g ON g.id = gi."grnId"
      WHERE g."tenantId" = ${tenantId} AND g."branchId" = ANY(${branchIds}) AND gi."costPaise" IS NOT NULL AND gi."costPaise" > 0 AND g."approvedAt" >= ${since}
      ORDER BY g."approvedAt" ASC`,
    db.$queryRaw<{ n: bigint }[]>`
      SELECT count(*)::bigint n FROM "GrnItem" gi JOIN "Grn" g ON g.id = gi."grnId"
      WHERE g."tenantId" = ${tenantId} AND g."branchId" = ANY(${branchIds}) AND gi."costPaise" IS NULL AND g."approvedAt" >= ${since}`,
  ]);
  return { rows, missing: Number(missing[0]?.n ?? 0) };
}

async function evaluate(ctx: Ctx, ids: string[], now: Date) {
  const since = new Date(now.getTime() - QUOTE_WINDOW_DAYS * DAY);
  const [sups, perf, ln] = await Promise.all([
    db.supplier.findMany({ where: { tenantId: ctx.tenantId } }),
    supplierPerformance(db, ctx.tenantId, ids),
    lines(ctx.tenantId, ids, since),
  ]);
  // Latest landed cost per medicine and supplier, and first/last in the window for the price trend.
  const latest = new Map<string, Map<string, Line>>(), first = new Map<string, Line>();
  for (const l of ln.rows) {
    const m = latest.get(l.medicineId) ?? new Map(); m.set(l.supplierId, l); latest.set(l.medicineId, m);
    const k = `${l.medicineId}:${l.supplierId}`; if (!first.has(k)) first.set(k, l);
  }
  const factsOf = (s: (typeof sups)[number]): SupplierFacts => {
    const p = perf.get(s.id);
    return { orders: p?.orders ?? 0, fillPct: p ? p.fillPct : null, onTimePct: p ? p.onTimePct : null, creditDays: s.creditDays, acceptsReturns: s.acceptsReturns, returnWindowDays: s.returnWindowDays };
  };
  const byId = new Map(sups.map((s) => [s.id, s]));
  const meds = await db.medicine.findMany({ where: { id: { in: [...latest.keys()] } }, select: { id: true, name: true, strength: true } });
  const medName = new Map(meds.map((m) => [m.id, `${m.name} ${m.strength}`.trim()]));

  const recs: MedicineRec[] = [], ratios = new Map<string, number[]>();
  for (const [mid, bySup] of latest) {
    const quotes: Quote[] = [...bySup.values()].filter((l) => byId.has(l.supplierId)).map((l) => ({ supplierId: l.supplierId, name: byId.get(l.supplierId)!.name, landedPaise: Number(l.cost), at: l.at.toISOString(), facts: factsOf(byId.get(l.supplierId)!) }));
    const rec = recommend(quotes);
    if (!rec) continue;
    const best = Math.min(...quotes.map((x) => x.landedPaise));
    for (const x of quotes) ratios.set(x.supplierId, [...(ratios.get(x.supplierId) ?? []), x.landedPaise / best]);
    recs.push({ medicineId: mid, medicine: medName.get(mid) ?? "", rec, quotes: quotes.map((x) => ({ supplier: x.name, landedPaise: x.landedPaise, at: x.at })) });
  }
  const rows: SupplierRow[] = sups.map((s) => {
    const r = ratios.get(s.id) ?? [];
    const idx = r.length ? r.reduce((a, b) => a + b, 0) / r.length : null;
    const trend: number[] = [];
    for (const [mid, bySup] of latest) { const l = bySup.get(s.id), f = first.get(`${mid}:${s.id}`); if (l && f && f.at < l.at && f.cost > 0n) trend.push((Number(l.cost - f.cost) / Number(f.cost)) * 100); }
    const f = factsOf(s);
    return {
      id: s.id, name: s.name, score: scoreSupplier(f, idx), orders: f.orders, fillPct: f.fillPct, onTimePct: f.onTimePct, creditDays: s.creditDays, leadDays: Number(s.leadDays),
      acceptsReturns: s.acceptsReturns, returnWindowDays: s.returnWindowDays, comparedMedicines: r.length, priceIndexPct: idx == null ? null : (idx - 1) * 100,
      priceChange180Pct: trend.length ? trend.reduce((a, b) => a + b, 0) / trend.length : null,
    };
  }).sort((a, b) => b.score.score - a.score.score || a.name.localeCompare(b.name));
  recs.sort((a, b) => a.medicine.localeCompare(b.medicine));
  return { rows, recs, missing: ln.missing };
}

export async function supplierIntel(ctx: Ctx, branchId: string | null = null, now = new Date()): Promise<SupplierIntel> {
  authorize(ctx, "reports");
  const sc = scopeBranches(ctx, branchId);
  const main = await evaluate(ctx, sc.ids, now);
  const perBranch = ctx.branches.length > 1 && !sc.id
    ? await Promise.all(ctx.branches.map(async (b) => ({ branchId: b.id, branch: b.name, top: (await evaluate(ctx, [b.id], now)).rows.filter((r) => r.orders > 0 || r.comparedMedicines > 0).slice(0, 3).map((r) => ({ name: r.name, score: r.score.score })) })))
    : [];
  return { scope: { branchId: sc.id, branchName: sc.name, branchIds: sc.ids }, suppliers: main.rows, recommendations: main.recs, byBranch: perBranch, linesWithoutLandedCost: main.missing };
}

/** Landed cost per supplier for one medicine over time, oldest first. */
export async function priceHistory(ctx: Ctx, medicineId: string, branchId: string | null = null): Promise<{ supplier: string; points: PricePoint[] }[]> {
  authorize(ctx, "reports");
  const sc = scopeBranches(ctx, branchId);
  const m = await db.medicine.findFirst({ where: { id: medicineId, tenantId: ctx.tenantId }, select: { id: true } });
  if (!m) throw new UserError("Medicine not found.");
  const rows = await db.$queryRaw<{ supplierId: string; cost: bigint; at: Date }[]>`
    SELECT g."supplierId", gi."costPaise" cost, g."approvedAt" at FROM "GrnItem" gi JOIN "Grn" g ON g.id = gi."grnId"
    WHERE g."tenantId" = ${ctx.tenantId} AND g."branchId" = ANY(${sc.ids}) AND gi."medicineId" = ${medicineId} AND gi."costPaise" IS NOT NULL ORDER BY g."approvedAt" ASC`;
  const sups = await db.supplier.findMany({ where: { tenantId: ctx.tenantId, id: { in: [...new Set(rows.map((r) => r.supplierId))] } }, select: { id: true, name: true } });
  return sups.map((s) => ({ supplier: s.name, points: rows.filter((r) => r.supplierId === s.id).map((r) => ({ at: r.at.toISOString(), landedPaise: Number(r.cost) })) }));
}

export type { Ranked };
