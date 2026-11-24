import "server-only";
import { db } from "@/server/db";
import type { Me } from "./auth";

// Who may see whom.
//  * Nobody but the super admin can tell who the super admin is: they are left out of every directory, member list and calendar,
//    and where their name would show (a message, a task they set) it reads "Admin".
//  * HR and the super admin see everyone else. Every other employee sees only their own department, their manager, the people
//    who report to them, and HR. There is no company-wide member list for them.
export const ADMIN_LABEL = "Admin";

type Viewer = Pick<Me, "role">;
/** Whether the super admin's identity must be hidden from this viewer (everyone but the super admin). */
export const hideAdmin = (v: Partial<Viewer>) => v.role !== undefined && v.role !== "admin";
/** HR and the super admin may see the whole company. */
export const seesAll = (v: Viewer) => v.role === "admin" || v.role === "hr";

export async function superAdminIds(): Promise<Set<string>> {
  return new Set((await db.staffUser.findMany({ where: { role: "super_admin" }, select: { id: true } })).map((u) => u.id));
}

/** The people an ordinary employee may see: their department, manager, reports and HR. `null` means no restriction. */
export async function teamIds(me: Pick<Me, "id" | "role">): Promise<Set<string> | null> {
  if (seesAll(me)) return null;
  const mine = await db.hrProfile.findUnique({ where: { staffId: me.id }, select: { dept: true, managerId: true } });
  const rows = await db.hrProfile.findMany({
    where: { OR: [...(mine?.dept ? [{ dept: mine.dept }] : []), ...(mine?.managerId ? [{ staffId: mine.managerId }] : []), { managerId: me.id }, { role: "hr" as const }] },
    select: { staffId: true },
  });
  return new Set([...rows.map((r) => r.staffId), me.id]);
}

/** Of these people, the ones this viewer may see or start a chat with. */
export async function visibleTo(me: Pick<Me, "id" | "role">, ids: string[]): Promise<string[]> {
  if (me.role === "admin") return ids;
  const [team, admins] = await Promise.all([teamIds(me), superAdminIds()]);
  return ids.filter((id) => !admins.has(id) && (!team || team.has(id)));
}
