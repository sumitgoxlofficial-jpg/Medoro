import "server-only";
import { db } from "@/server/db";
import type { Ctx } from "@/server/context";
import { customerBalances } from "@/domain/parties/balances";
import { listChemists } from "@/domain/distribution/masters";

/** Chemists for entry screens, with balances, limited to a salesman's own when the user is one. */
export async function entryChemists(ctx: Ctx, opts: { salesmanOnly?: boolean } = {}) {
  const sm = opts.salesmanOnly ? await db.distSalesman.findFirst({ where: { tenantId: ctx.tenantId, userId: ctx.userId, active: true } }) : null;
  const [rows, bal] = await Promise.all([listChemists(ctx, sm ? { salesmanId: sm.id } : {}), customerBalances(db, ctx.tenantId)]);
  return rows.map((c) => ({ id: c.id, name: c.name, status: c.status, dlExpiry: c.dlExpiry, stateCode: c.stateCode, limit: c.creditLimit, balance: bal.get(c.id) ?? 0 }));
}

/** GST state of the current godown (branch GSTIN, else the tenant's). */
export async function ownState(ctx: Ctx) {
  const [b, t] = await Promise.all([db.branch.findUnique({ where: { id: ctx.branchId }, select: { gstin: true } }), db.tenant.findUnique({ where: { id: ctx.tenantId }, select: { gstin: true } })]);
  return (b?.gstin ?? t?.gstin ?? "").slice(0, 2);
}
