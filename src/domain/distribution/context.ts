import "server-only";
import { redirect } from "next/navigation";
import { ForbiddenError } from "@/domain/identity/permissions";
import { getCtx, ReadOnlyError, requireSubscription, type Ctx } from "@/server/context";
import { db } from "@/server/db";
import { DIST_BUSINESS, DIST_PERM_LABEL, distPerms, type DistPerm } from "./perms";
import { distMustMove } from "./hosting";

export type DistCtx = Ctx & { product: "distribution" };

/** Distribution context: the shared session context with distribution permissions in place of pharmacy ones. */
export async function distCtxFrom(ctx: Ctx): Promise<DistCtx | null> {
  const u = await db.user.findUnique({ where: { id: ctx.userId }, include: { role: true, tenant: { select: { product: true } } } });
  if (!u || u.tenant.product !== "distribution") return null;
  // Distribution records live in the server database (see hosting.ts); there is no Drive move for a distributor.
  return { ...ctx, perms: distPerms(u.role.permissions, u.permGrants, u.permRevokes), product: "distribution", moved: false, mustMove: distMustMove() };
}

export async function getDistCtx(): Promise<DistCtx | null> {
  const c = await getCtx();
  return c ? distCtxFrom(c) : null;
}

/** For /dist pages: signed in to a distribution tenant, else to sign-in (or to the pharmacy app). */
export async function requireDistCtx(): Promise<DistCtx> {
  const c = await getCtx();
  if (!c) redirect("/signin");
  const d = await distCtxFrom(c);
  if (!d) redirect("/app");
  return d;
}

export const distCan = (ctx: Ctx, p: DistPerm) => ctx.perms.includes(p);

class DistForbidden extends ForbiddenError {
  constructor(p: DistPerm) { super(p); this.message = `Your role cannot do this (needs “${DIST_PERM_LABEL[p]}”).`; }
}

/** Permission check for changes. Read-only support never passes; business changes need a live subscription. */
export function distAuthorize(ctx: Ctx, p: DistPerm) {
  if (ctx.readOnly) throw new ReadOnlyError();
  if (!distCan(ctx, p)) throw new DistForbidden(p);
  if (DIST_BUSINESS.has(p)) requireSubscription(ctx);
}

export function distAuthorizeAny(ctx: Ctx, ...ps: DistPerm[]) {
  if (ctx.readOnly) throw new ReadOnlyError();
  if (!ps.some((p) => distCan(ctx, p))) throw new DistForbidden(ps[0]);
  if (ps.some((p) => DIST_BUSINESS.has(p))) requireSubscription(ctx);
}

/** For screens that only show data. */
export function distView(ctx: Ctx, ...ps: DistPerm[]) {
  if (!ps.some((p) => distCan(ctx, p))) throw new DistForbidden(ps[0]);
}
