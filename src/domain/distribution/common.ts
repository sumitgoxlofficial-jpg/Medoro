import "server-only";
import { db, type DbOrTx, type Tx } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { UserError } from "@/server/action";
import { licenceState } from "@/domain/system/access";
import type { Ctx } from "@/server/context";
import { distEntitlements, distHas, distUpgrade, type DistFeature, type DistLimits } from "./plans";
import { distSettingsOf } from "./settings-shape";

export const audit = (tx: DbOrTx, ctx: Ctx, action: string, entity: string, entityId: string | null, detail: string) =>
  writeAudit(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action, entity, entityId, detail: detail.slice(0, 480) });

export async function distSettings(tenantId: string, q: DbOrTx = db) {
  const t = await q.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true } });
  return distSettingsOf(t.settings);
}

export async function distEnt(tenantId: string) {
  const [st, m] = await Promise.all([licenceState(tenantId), db.subscriptionMeta.findUnique({ where: { tenantId }, select: { plan: true, status: true } })]);
  return distEntitlements({ plan: m?.plan ?? null, status: m?.status ?? null, unlicensed: st.access.phase === "unlicensed" });
}

export class DistPlanError extends Error { status = 402; }

export async function requireDistFeature(tenantId: string, f: DistFeature) {
  const e = await distEnt(tenantId);
  if (!distHas(e, f)) throw new DistPlanError(distUpgrade(e, f));
}

export async function requireDistRoom(tenantId: string, what: keyof DistLimits, now: number) {
  const e = await distEnt(tenantId);
  if (now >= e.limits[what]) throw new DistPlanError(`Your plan allows ${e.limits[what]} ${what}. Upgrade under Subscription to add more.`);
}

/** Per-row lock for a business key inside a transaction (orders, customers, godown stock). */
export const lockKey = (tx: Tx, key: string) => tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${key}))`;

/** Godown (branch) of this tenant that the user may work in. */
export async function godownOf(q: DbOrTx, ctx: Ctx, branchId: string) {
  if (!ctx.branches.some((b) => b.id === branchId)) throw new UserError("You don’t have access to that godown.");
  const b = await q.branch.findFirst({ where: { id: branchId, tenantId: ctx.tenantId, active: true } });
  if (!b) throw new UserError("Godown not found.");
  return b;
}

export const num = (v: unknown) => (v == null ? 0 : Number(v));
