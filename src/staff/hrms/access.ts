import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { MODULES, type HrRoleId, type ModuleId, type Perms } from "./constants";

// Per-person access on top of the role matrix (Roles & Permissions). The super admin can give one person a module their
// role doesn't have ("grant"), or take one away that their role does have ("deny"), with a reason and, if wanted, an end
// date. A deny always wins. Nothing here can touch the super admin, who always has every module.
// This file has no dependency on auth.ts, so auth can apply the grants while it builds the signed-in person.

export type Grants = { allow: ModuleId[]; deny: ModuleId[] };
export const NO_GRANTS: Grants = { allow: [], deny: [] };
const moduleIds = MODULES.map((m) => m.id) as [ModuleId, ...ModuleId[]];
export const grantInput = z.object({
  staffId: z.string().min(1),
  module: z.enum(moduleIds, { error: "Choose a module." }),
  effect: z.enum(["grant", "deny"]),
  reason: z.string().trim().min(5, "Say why (at least a few words): it is kept with the grant.").max(300),
  /** Last day the grant applies (YYYY-MM-DD), or empty for no end. */
  until: z.string().regex(/^$|^\d{4}-\d{2}-\d{2}$/, "Pick the end date.").default(""),
});

const live = (now = new Date()) => ({ revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] });

/** The grants and denials in force for these people right now. */
export async function grantsFor(staffIds: string[], now = new Date()): Promise<Map<string, Grants>> {
  const out = new Map<string, Grants>();
  if (!staffIds.length) return out;
  const rows = await db.hrAccessGrant.findMany({ where: { staffId: { in: staffIds }, ...live(now) }, select: { staffId: true, module: true, effect: true } });
  for (const r of rows) {
    const g = out.get(r.staffId) ?? { allow: [], deny: [] };
    if (!(moduleIds as string[]).includes(r.module)) continue; // a module that no longer exists
    (r.effect === "deny" ? g.deny : g.allow).push(r.module as ModuleId);
    out.set(r.staffId, g);
  }
  return out;
}

/**
 * The permission matrix as this one person experiences it: their role's row with their own grants added and their
 * denials removed. Everything that checks `hasModule(role, perms, m)` (actions, screens, menus) then agrees.
 */
export function effectivePerms(role: HrRoleId, perms: Perms, g: Grants | undefined): Perms {
  if (role === "admin" || !g || (!g.allow.length && !g.deny.length)) return perms;
  const row = [...new Set([...perms[role], ...g.allow])].filter((m) => !g.deny.includes(m));
  return { ...perms, [role]: row };
}
export const hasGrants = (g: Grants | undefined) => !!g && (g.allow.length > 0 || g.deny.length > 0);

/** Checks a grant request against who it is for (used by the super admin's form and by approved access requests). */
export async function checkGrantTarget(staffId: string) {
  const u = await db.staffUser.findUnique({ where: { id: staffId }, select: { kind: true, role: true, status: true, deletedAt: true } });
  if (!u || u.kind !== "team" || u.role === "partner" || u.deletedAt || u.status !== "active") throw new UserError("Choose an active employee.");
  if (u.role === "super_admin") throw new UserError("The super admin already has every module.");
}
