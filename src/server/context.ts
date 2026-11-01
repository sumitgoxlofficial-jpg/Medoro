import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DEFAULT_GRANTS, effectivePerms, ForbiddenError, type Perm, type RoleName, ROLE_NAMES } from "@/domain/identity/permissions";
import { accessFor } from "@/domain/system/access";
import { db } from "./db";
import { readSession } from "./auth";

export const BRANCH_COOKIE = "medoro_branch";
export const VIEWAS_COOKIE = "medoro_viewas";
export const LANG_COOKIE = "medoro_lang";

export type Ctx = {
  tenantId: string;
  tenantName: string;
  userId: string;
  userName: string;
  userEmail: string;
  realRole: string;
  role: string; // effective role (View as)
  perms: string[];
  branchId: string;
  branchName: string;
  branchCode: string;
  branches: { id: string; name: string; code: string }[];
  lang: "en" | "hi";
  sessionId: string;
  counterId: string | null;
  counterName: string | null;
  /** Medoro support, signed in with a link the owner granted: can look, can't change or download anything. */
  readOnly?: boolean;
  /** The subscription has run out (after grace): sales, purchases, stock changes and messaging are refused. */
  locked?: boolean;
  /** The pharmacy moved its data to Google Drive (or is moving it): Medoro's copy is read-only. */
  moved?: boolean;
};

export class ReadOnlyError extends Error {
  status = 403;
  constructor() { super("Medoro support access is read-only. Ask the pharmacy owner to make this change."); }
}

export class SubscriptionLockedError extends Error {
  status = 402;
  constructor() { super("Subscription expired — renew from Plan. Sales, purchases, stock changes and messages are paused; viewing, exports and backups still work."); }
}

export class MovedToDriveError extends Error {
  status = 409;
  constructor() { super("This pharmacy’s data now lives in its Google Drive, so Medoro’s copy is read-only. Bill and make changes on the Billing (device) screen."); }
}

/** Permissions that change business records. Users, integrations, reports and backups stay usable when the subscription lapses. */
const BUSINESS_PERMS = new Set<string>(["sale", "disc", "credit", "refund", "adjust", "purchase", "payments", "aiAct"]);

/** For changes that need a live subscription but aren't covered by a business permission (e.g. sending messages). */
export function requireSubscription(ctx: Ctx) {
  if (ctx.locked) throw new SubscriptionLockedError();
  if (ctx.moved) throw new MovedToDriveError();
}

/** Loads the signed-in user's context for this request, or null. */
export const getCtx = cache(async (): Promise<Ctx | null> => {
  const s = await readSession();
  if (!s) return null;
  const u = s.user;
  const c = await cookies();
  const all = await db.branch.findMany({ where: { tenantId: u.tenantId, active: true }, orderBy: { createdAt: "asc" } });
  const branches = u.branchIds.length ? all.filter((b) => u.branchIds.includes(b.id)) : all;
  const wanted = c.get(BRANCH_COOKIE)?.value;
  const br = branches.find((b) => b.id === wanted) ?? branches[0];

  // Per-user overrides apply on top of the role. "View as" lets an owner preview another role; it can only narrow.
  const own = effectivePerms(u.role.permissions, u.permGrants, u.permRevokes);
  let role = u.role.name, perms: string[] = own;
  const va = c.get(VIEWAS_COOKIE)?.value;
  if (va && va !== role && own.includes("users") && (ROLE_NAMES as readonly string[]).includes(va)) {
    const r = await db.role.findFirst({ where: { tenantId: u.tenantId, name: va } });
    const p = r?.permissions ?? DEFAULT_GRANTS[va as RoleName];
    perms = p.filter((x) => own.includes(x as Perm));
    role = va;
  }
  return {
    tenantId: u.tenantId, tenantName: u.tenant.name, userId: u.id, userName: u.name,
    userEmail: u.email ?? u.phone ?? "", realRole: u.role.name, role, perms,
    branchId: br.id, branchName: br.name, branchCode: br.code,
    branches: branches.map((b) => ({ id: b.id, name: b.name, code: b.code })),
    lang: c.get(LANG_COOKIE)?.value === "hi" ? "hi" : "en", sessionId: s.id,
    counterId: s.counterId, counterName: s.counterId ? (await db.counter.findUnique({ where: { id: s.counterId } }))?.name ?? null : null,
    readOnly: u.isSupport,
    locked: (await accessFor(u.tenantId)).readOnly,
    moved: !!(u.tenant.settings as { driveMove?: unknown } | null)?.driveMove,
  };
});

export async function requireCtx(): Promise<Ctx> {
  const ctx = await getCtx();
  if (!ctx) redirect("/signin");
  return ctx;
}

export const can = (ctx: Ctx, p: Perm) => ctx.perms.includes(p);

/** Permission check for changes (and downloads). Read-only support sessions never pass. */
export function authorize(ctx: Ctx, p: Perm) {
  if (ctx.readOnly) throw new ReadOnlyError();
  if (!can(ctx, p)) throw new ForbiddenError(p);
  if (BUSINESS_PERMS.has(p)) requireSubscription(ctx);
}

export function authorizeAny(ctx: Ctx, ...ps: Perm[]) {
  if (ctx.readOnly) throw new ReadOnlyError();
  if (!ps.some((p) => can(ctx, p))) throw new ForbiddenError(ps[0]);
  if (ps.every((p) => BUSINESS_PERMS.has(p))) requireSubscription(ctx);
}

/** Permission check for screens that only show data (any of `ps`); read-only support sessions may look. */
export function authorizeView(ctx: Ctx, ...ps: [Perm, ...Perm[]]) {
  if (!ps.some((p) => can(ctx, p))) throw new ForbiddenError(ps[0]);
}
