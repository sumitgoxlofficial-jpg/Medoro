import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { DEFAULT_GRANTS, ForbiddenError, type Perm, type RoleName, ROLE_NAMES } from "@/domain/identity/permissions";
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
};

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

  // "View as" lets an owner preview another role. It can only narrow permissions.
  let role = u.role.name, perms = u.role.permissions;
  const va = c.get(VIEWAS_COOKIE)?.value;
  if (va && va !== role && perms.includes("users") && (ROLE_NAMES as readonly string[]).includes(va)) {
    const r = await db.role.findFirst({ where: { tenantId: u.tenantId, name: va } });
    const p = r?.permissions ?? DEFAULT_GRANTS[va as RoleName];
    perms = p.filter((x) => u.role.permissions.includes(x));
    role = va;
  }
  return {
    tenantId: u.tenantId, tenantName: u.tenant.name, userId: u.id, userName: u.name,
    userEmail: u.email ?? u.phone ?? "", realRole: u.role.name, role, perms,
    branchId: br.id, branchName: br.name, branchCode: br.code,
    branches: branches.map((b) => ({ id: b.id, name: b.name, code: b.code })),
    lang: c.get(LANG_COOKIE)?.value === "hi" ? "hi" : "en", sessionId: s.id,
  };
});

export async function requireCtx(): Promise<Ctx> {
  const ctx = await getCtx();
  if (!ctx) redirect("/signin");
  return ctx;
}

export const can = (ctx: Ctx, p: Perm) => ctx.perms.includes(p);

export function authorize(ctx: Ctx, p: Perm) {
  if (!can(ctx, p)) throw new ForbiddenError(p);
}
