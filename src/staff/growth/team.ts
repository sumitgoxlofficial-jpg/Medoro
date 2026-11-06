import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { dateOnly, todayISO } from "@/lib/dates";
import { gaudit, need, type Actor } from "./access";
import { INDIAN_STATES, PIN_RE } from "./constants";

/**
 * Growth employees are existing staff console profiles (created and approved under Employees). Here a Growth admin gives
 * them a Growth role and team; no second account is created.
 */
export async function members(a: Actor) {
  need(a, "targets.set");
  const staff = await db.staffUser.findMany({
    where: { kind: "team", role: { not: "partner" }, ...(a.growthRole === "manager" ? { id: { in: a.teamStaffIds } } : {}) },
    select: { id: true, name: true, empNo: true, email: true, role: true, status: true, growthMember: { include: { team: true } }, territories: true, callingTargets: { orderBy: { effectiveFrom: "desc" }, take: 4 } },
    orderBy: { name: "asc" },
  });
  const teams = await db.growthTeam.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } });
  const active = await db.leadAssignment.groupBy({ by: ["staffId"], where: { active: true }, _count: true });
  const load = new Map(active.map((r) => [r.staffId, r._count]));
  return {
    teams,
    staff: staff.map((s) => ({
      id: s.id, name: s.name, empNo: s.empNo, email: s.email, staffRole: s.role, status: s.status,
      growthRole: s.role === "super_admin" ? "admin" : s.growthMember?.active ? s.growthMember.role : null,
      memberActive: s.growthMember?.active ?? false, teamId: s.growthMember?.teamId ?? null, team: s.growthMember?.team?.name ?? "",
      territories: s.territories.map((t) => ({ id: t.id, state: t.state, district: t.district, pin: t.pin })),
      targets: latestTargets(s.callingTargets), activeLeads: load.get(s.id) ?? 0,
    })),
  };
}

export const memberSchema = z.object({ staffId: z.string().uuid(), role: z.enum(["manager", "sales", "analyst"]), teamId: z.string().uuid().nullable().default(null), active: z.boolean().default(true) });
export async function setMember(a: Actor, raw: z.input<typeof memberSchema>) {
  need(a, "team.manage");
  const i = memberSchema.parse(raw);
  const s = await db.staffUser.findUnique({ where: { id: i.staffId } });
  if (!s || s.kind !== "team" || s.role === "partner") throw new UserError("Only Medoro team profiles can join Growth Intelligence. Reference partners can’t.");
  if (s.role === "super_admin") throw new UserError("Super admins already have full Growth access.");
  if (i.teamId && !(await db.growthTeam.findFirst({ where: { id: i.teamId, deletedAt: null } }))) throw new UserError("Team not found.");
  await db.growthMember.upsert({ where: { staffId: s.id }, create: { staffId: s.id, role: i.role, teamId: i.teamId, active: i.active, addedBy: a.id }, update: { role: i.role, teamId: i.teamId, active: i.active } });
  await gaudit(a, i.active ? "Growth role set" : "Growth access removed", "member", s.id, `${s.empNo} · ${i.role}${i.teamId ? " · team " + i.teamId : ""}`);
}

export async function saveTeam(a: Actor, raw: { id?: string; name: string; managerId: string | null }) {
  need(a, "team.manage");
  const name = z.string().trim().min(2).max(60).parse(raw.name);
  if (raw.managerId) {
    const m = await db.growthMember.findUnique({ where: { staffId: raw.managerId } });
    if (!m || m.role !== "manager" || !m.active) throw new UserError("The team manager must have the Marketing manager role.");
  }
  const t = raw.id
    ? await db.growthTeam.update({ where: { id: raw.id }, data: { name, managerId: raw.managerId } })
    : await db.growthTeam.create({ data: { name, managerId: raw.managerId } }).catch(() => { throw new UserError("A team with this name exists."); });
  await gaudit(a, raw.id ? "Team updated" : "Team created", "team", t.id, name);
  return t.id;
}

const inScope = (a: Actor, staffId: string) => {
  if (a.growthRole === "admin") return;
  if (a.growthRole === "manager" && a.teamStaffIds.includes(staffId)) return;
  throw new UserError("That employee isn’t in your team.");
};

export const territorySchema = z.object({ state: z.enum(INDIAN_STATES), district: z.string().trim().max(80).default(""), pin: z.string().trim().default("").refine((p) => !p || PIN_RE.test(p), "PIN code must be 6 digits.") });
export async function addTerritory(a: Actor, staffId: string, raw: z.input<typeof territorySchema>) {
  need(a, "assign");
  inScope(a, staffId);
  const t = territorySchema.parse(raw);
  await db.employeeTerritory.upsert({ where: { staffId_state_district_pin: { staffId, ...t } }, create: { staffId, ...t, createdBy: a.id }, update: {} });
  await gaudit(a, "Territory added", "territory", staffId, `${t.state}${t.district ? " / " + t.district : ""}${t.pin ? " / " + t.pin : ""}`);
}
export async function removeTerritory(a: Actor, id: string) {
  need(a, "assign");
  const t = await db.employeeTerritory.findUnique({ where: { id } });
  if (!t) throw new UserError("Territory not found.");
  inScope(a, t.staffId);
  await db.employeeTerritory.delete({ where: { id } });
  await gaudit(a, "Territory removed", "territory", t.staffId, `${t.state} ${t.district} ${t.pin}`.trim());
}

export const targetSchema = z.object({
  staffId: z.string().uuid(), period: z.enum(["daily", "weekly"]),
  calls: z.coerce.number<string | number>().int().min(0).max(1000), connected: z.coerce.number<string | number>().int().min(0).max(1000).default(0),
  conversions: z.coerce.number<string | number>().int().min(0).max(1000).default(0), effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
});
export async function setTarget(a: Actor, raw: z.input<typeof targetSchema>) {
  need(a, "targets.set");
  const i = targetSchema.parse(raw);
  inScope(a, i.staffId);
  const t = await db.employeeCallingTarget.create({ data: { staffId: i.staffId, period: i.period, calls: i.calls, connected: i.connected, conversions: i.conversions, effectiveFrom: dateOnly(i.effectiveFrom ?? todayISO()), setBy: a.id } });
  await gaudit(a, "Calling target set", "target", i.staffId, `${i.period}: ${i.calls} calls, ${i.connected} connected, ${i.conversions} conversions from ${i.effectiveFrom ?? todayISO()}`);
  return t.id;
}

type T = { period: string; calls: number; connected: number; conversions: number; effectiveFrom: Date };
export function latestTargets(rows: T[], onIso = todayISO()) {
  const on = dateOnly(onIso);
  const pick = (p: string) => rows.filter((r) => r.period === p && r.effectiveFrom <= on).sort((x, y) => y.effectiveFrom.getTime() - x.effectiveFrom.getTime())[0] ?? null;
  const fmt = (r: T | null) => (r ? { calls: r.calls, connected: r.connected, conversions: r.conversions } : null);
  return { daily: fmt(pick("daily")), weekly: fmt(pick("weekly")) };
}
export async function targetsFor(staffId: string, onIso = todayISO()) {
  return latestTargets(await db.employeeCallingTarget.findMany({ where: { staffId }, orderBy: { effectiveFrom: "desc" }, take: 20 }), onIso);
}

// ── Sales employees who signed up with Google on the employee page wait here for a super admin.
export async function pendingEmployees(a: Actor) {
  need(a, "team.manage");
  return db.staffUser.findMany({ where: { kind: "team", role: "sales", status: "pending" }, select: { id: true, empNo: true, name: true, email: true, phone: true, team: true, googleSub: true, createdAt: true }, orderBy: { createdAt: "asc" } });
}

/** Approve: the profile becomes active and gets the Sales employee Growth role (optionally in a team). Reject: deactivated. */
export async function decideEmployee(a: Actor, staffId: string, approve: boolean, teamId: string | null = null) {
  need(a, "team.manage");
  const u = await db.staffUser.findUnique({ where: { id: staffId } });
  if (!u || u.kind !== "team" || u.role !== "sales" || u.status !== "pending") throw new UserError("This sign-up was already decided.");
  if (teamId && !(await db.growthTeam.findFirst({ where: { id: teamId, deletedAt: null } }))) throw new UserError("Team not found.");
  await db.$transaction(async (tx) => {
    const r = await tx.staffUser.updateMany({ where: { id: staffId, status: "pending" }, data: approve ? { status: "active", approvedBy: a.id } : { status: "deactivated", tokenVersion: { increment: 1 } } });
    if (!r.count) throw new UserError("This sign-up was already decided.");
    if (approve) await tx.growthMember.upsert({ where: { staffId }, create: { staffId, role: "sales", teamId, active: true, addedBy: a.id }, update: { role: "sales", teamId, active: true } });
    await tx.staffAudit.create({ data: { staffId: a.id, staffName: a.name, action: approve ? "Employee approved" : "Employee sign-up rejected", detail: `${u.empNo} · ${u.email}` } });
  });
  await gaudit(a, approve ? "Employee approved" : "Employee sign-up rejected", "member", staffId, `${u.empNo} · ${u.email}${u.googleSub ? " · Google" : ""}`);
}
