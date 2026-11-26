import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined), set: (k: string, v: string) => (v ? jar.set(k, v) : jar.delete(k)), delete: (k: string) => jar.delete(k) }),
  headers: async () => new Headers({ "x-forwarded-for": "10.0.0.5", "user-agent": "vitest" }),
}));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error("redirect " + u); } }));

import { db } from "@/server/db";
import { loadPerms, type Me } from "@/staff/hrms/auth";
import { myTeam, reportCount } from "@/staff/hrms/team";
import { assignTask } from "@/staff/hrms/work";
import { decideLeave } from "@/staff/hrms/time";
import { addDays, todayISO } from "@/lib/dates";
import { seal } from "@/server/vault";
import { resetDb } from "./helpers";

let mgr: Me, emp: Me, other: Me;
const mkMe = async (id: string): Promise<Me> => { const u = await db.staffUser.findUniqueOrThrow({ where: { id }, include: { hr: true } }); return { id, empNo: u.empNo, name: u.name, first: u.name.split(" ")[0], email: u.email, staffRole: u.role, role: u.hr!.role, perms: await loadPerms(), sessionId: "t", phone: u.phone, personalEmail: "", dept: "", designation: "", photo: null, mustChangePassword: false, profileDone: true, docsAccepted: true, kycSubmitted: true, kycSkipped: false, kycVerified: true }; };
const mk = (empNo: string, name: string, email: string, role: "super_admin" | "employee", hr: "admin" | "employee" | "finance", managerId?: string) =>
  db.staffUser.create({ data: { empNo, name, email, kind: "team", phone: "982000000" + empNo.slice(-1), role, status: "active", hr: { create: { role: hr, managerId: managerId ?? null, ctc: 600000, joinDate: new Date("2026-01-05"), profileDone: true, docsAcceptedAt: new Date(), bankAccountSealed: new Uint8Array(seal("123456789012")), bankLast4: "9012", bankIfsc: "HDFC0001234", bankHolder: name } } } });

beforeAll(async () => {
  await resetDb();
  process.env.SESSION_SECRET ||= "test-only-secret-0123456789abcdef0123";
  await mk("MS-001", "Asha Admin", "asha@medoro.in", "super_admin", "admin");
  mgr = await mkMe((await mk("MS-002", "Manu Manager", "manu@medoro.in", "employee", "employee")).id);
  emp = await mkMe((await mk("MS-003", "Esha Employee", "esha@medoro.in", "employee", "employee", mgr.id)).id);
  other = await mkMe((await mk("MS-004", "Omar Other", "omar@medoro.in", "employee", "employee")).id);
});
beforeEach(() => jar.clear());

describe("My Team", () => {
  it("shows a manager only their direct reports, and nothing for someone without reports", async () => {
    expect(await reportCount(mgr.id)).toBe(1);
    expect(await reportCount(other.id)).toBe(0);
    const t = await myTeam(mgr);
    expect(t.people.map((p) => p.name)).toEqual(["Esha Employee"]);
    expect(Object.keys(t.people[0])).not.toEqual(expect.arrayContaining(["ctc"]));
    expect(JSON.stringify(t)).not.toMatch(/9012|HDFC|600000/); // no bank or pay data
    expect((await myTeam(other)).people).toEqual([]);
  });
  it("a manager gives plain tasks to their reports only; projects still need Tasks & projects", async () => {
    await assignTask(mgr, { title: "Prepare the weekly report", assigneeId: emp.id, due: addDays(todayISO(), -1), priority: "High" });
    await expect(assignTask(mgr, { title: "Not my person", assigneeId: other.id })).rejects.toThrow(/role can’t/);
    await expect(assignTask(other, { title: "Not my person", assigneeId: emp.id })).rejects.toThrow(/role can’t/);
    const p = await db.hrProject.create({ data: { name: "P1" } });
    await expect(assignTask(mgr, { title: "Project work", assigneeId: emp.id, projectId: p.id })).rejects.toThrow(/role can’t/);
    const t = await myTeam(mgr);
    expect(t.tasks).toMatchObject([{ title: "Prepare the weekly report", who: "Esha Employee", overdue: true }]);
    expect(t.people[0]).toMatchObject({ tasksOpen: 1, tasksOverdue: 1 });
  });
  it("the manager sees and decides their report's leave request", async () => {
    const day = addDays(todayISO(), 5);
    const l = await db.hrLeave.create({ data: { staffId: emp.id, type: "casual", fromDay: new Date(day + "T00:00:00Z"), toDay: new Date(day + "T00:00:00Z"), days: 1, reason: "Family function" } });
    expect((await myTeam(mgr)).requests.map((r) => r.id)).toEqual([l.id]);
    await expect(decideLeave(other, l.id, true)).rejects.toThrow();
    await decideLeave(mgr, l.id, true);
    const t = await myTeam(mgr);
    expect(t.requests).toEqual([]);
    expect(t.out.map((o) => o.name)).toEqual(["Esha Employee"]);
  });
});
