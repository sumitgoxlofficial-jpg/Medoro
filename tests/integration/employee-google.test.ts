import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Minimal request context for cookies()/headers() outside Next.
const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined), set: (k: string, v: string) => (v ? jar.set(k, v) : jar.delete(k)), delete: (k: string | { name: string }) => jar.delete(typeof k === "string" ? k : k.name) }),
  headers: async () => new Headers({ "x-forwarded-for": "10.0.0.7", "user-agent": "vitest" }),
}));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error("redirect " + u); } }));

import { db } from "@/server/db";
import { getStaff, type Staff } from "@/staff/auth";
import { completeGoogleEmployee, employeeFromGoogle, setEmployeeStatus, signIn } from "@/staff/people";
import { actorFor } from "@/staff/growth/access";
import { decideEmployee, pendingEmployees } from "@/staff/growth/team";
import { resetDb } from "./helpers";

const g = (sub: string, email: string, name = "Ravi Kumar") => ({ sub, email, name });
let admin: Staff;

describe("sales employees: Google sign-up, admin approval, Google sign-in", () => {
  beforeAll(async () => {
    await resetDb();
    process.env.SESSION_SECRET ||= "test-only-secret-0123456789abcdef0123";
    const a = await db.staffUser.create({ data: { empNo: "T-001", name: "Aarti Admin", email: "aarti@medoro.in", kind: "team", phone: "9822010001", role: "super_admin", status: "active" } });
    admin = { id: a.id, empNo: a.empNo, name: a.name, email: a.email, role: a.role, referralCode: null, sessionId: "t" };
  });
  beforeEach(() => jar.clear());

  it("a new Google user creates a profile that waits for approval and can't sign in yet", async () => {
    expect(await employeeFromGoogle(g("g-ravi", "ravi.k@gmail.com"))).toBe("/staff/employee?google=new");
    await expect(completeGoogleEmployee({ name: "Ravi Kumar", phone: "98230 12345", agree: false as unknown as true })).rejects.toThrow(/employee terms/);
    const r = await completeGoogleEmployee({ name: "Ravi Kumar", phone: "98230 12345", team: "Pune West", agree: true });
    expect(r.pending).toBe(true);
    const u = await db.staffUser.findFirstOrThrow({ where: { email: "ravi.k@gmail.com" } });
    expect(u).toMatchObject({ kind: "team", role: "sales", status: "pending", googleSub: "g-ravi", passwordHash: null, phone: "9823012345" });
    // The held identity is single use.
    await expect(completeGoogleEmployee({ name: "Ravi Kumar", phone: "9823012345", agree: true })).rejects.toThrow(/expired/);
    expect(await employeeFromGoogle(g("g-ravi", "ravi.k@gmail.com"))).toBe("/staff/employee?google=pending");
    expect(await getStaff()).toBeNull();
    expect(await db.staffAudit.count({ where: { action: "Employee signed up with Google" } })).toBe(1);
  });

  it("only a super admin approves; approval activates and gives the Sales employee Growth role", async () => {
    const a = (await actorFor(admin))!;
    const pending = await pendingEmployees(a);
    expect(pending.map((p) => p.email)).toEqual(["ravi.k@gmail.com"]);
    const team = await db.growthTeam.create({ data: { name: "Pune West" } });
    await decideEmployee(a, pending[0].id, true, team.id);
    await expect(decideEmployee(a, pending[0].id, true)).rejects.toThrow(/already decided/);
    const u = await db.staffUser.findUniqueOrThrow({ where: { id: pending[0].id }, include: { growthMember: true } });
    expect(u).toMatchObject({ status: "active", approvedBy: admin.id, growthMember: { role: "sales", active: true, teamId: team.id } });
    expect(await db.growthAuditLog.count({ where: { action: "Employee approved" } })).toBe(1);
  });

  it("after approval Google signs them straight in, with Growth access and no authenticator step", async () => {
    expect(await employeeFromGoogle(g("g-ravi", "ravi.k@gmail.com"))).toBe("/staff/employee?google=ok");
    const s = await getStaff();
    expect(s).toMatchObject({ email: "ravi.k@gmail.com", role: "sales" });
    expect((await actorFor(s!))?.growthRole).toBe("sales");
    // The password form points them to the employee page instead.
    jar.clear();
    await expect(signIn("ravi.k@gmail.com", "anything-at-all", "team")).rejects.toThrow(/employee sign-in page/);
  });

  it("refuses other roles, partners, a different Google account and rejected sign-ups", async () => {
    // Admins and other non-sales staff use the Medoro team sign-in.
    expect(await employeeFromGoogle(g("g-aarti", "aarti@medoro.in"))).toBe("/staff/employee?google=notsales");
    expect(await getStaff()).toBeNull();
    // A Google account already used by a reference partner.
    await db.staffUser.create({ data: { empNo: "T-900", name: "MR Partner", email: "mr@gmail.com", kind: "partner", phone: "9822010099", role: "partner", status: "active", googleSub: "g-mr" } });
    expect(await employeeFromGoogle(g("g-mr", "mr@gmail.com"))).toBe("/staff/employee?google=partner");
    // Same email, different Google account.
    expect(await employeeFromGoogle(g("g-someone-else", "ravi.k@gmail.com"))).toBe("/staff/employee?google=mismatch");
    // A rejected sign-up can't get in.
    expect(await employeeFromGoogle(g("g-sita", "sita@gmail.com", "Sita"))).toBe("/staff/employee?google=new");
    await completeGoogleEmployee({ name: "Sita Rao", phone: "9823099999", agree: true });
    const a = (await actorFor(admin))!;
    const sita = (await pendingEmployees(a)).find((p) => p.email === "sita@gmail.com")!;
    await decideEmployee(a, sita.id, false);
    expect(await employeeFromGoogle(g("g-sita", "sita@gmail.com"))).toBe("/staff/employee?google=deactivated");
    expect(await getStaff()).toBeNull();
    // Non-admins can't see or decide sign-ups.
    const ravi = await db.staffUser.findFirstOrThrow({ where: { email: "ravi.k@gmail.com" } });
    const sales = (await actorFor({ id: ravi.id, empNo: ravi.empNo, name: ravi.name, email: ravi.email, role: ravi.role, referralCode: null, sessionId: "t" }))!;
    await expect(pendingEmployees(sales)).rejects.toThrow(/Growth role can’t/);
  });

  it("an approved password-based sales profile can link Google on first use", async () => {
    await db.staffUser.create({ data: { empNo: "T-010", name: "Karan Shah", email: "karan@medoro.in", kind: "team", phone: "9822010014", role: "sales", status: "active", passwordHash: "x" } });
    expect(await employeeFromGoogle(g("g-karan", "karan@medoro.in"))).toBe("/staff/employee?google=ok");
    expect((await db.staffUser.findFirstOrThrow({ where: { email: "karan@medoro.in" } })).googleSub).toBe("g-karan");
  });
  it("approving a Google sign-up on the Employees page activates it (not 'invited') with the Growth sales role", async () => {
    expect(await employeeFromGoogle(g("g-meena", "meena@gmail.com", "Meena"))).toBe("/staff/employee?google=new");
    await completeGoogleEmployee({ name: "Meena Iyer", phone: "9823055555", agree: true });
    const m = await db.staffUser.findFirstOrThrow({ where: { email: "meena@gmail.com" } });
    await setEmployeeStatus(admin, m.id, "approve");
    expect(await db.staffUser.findUniqueOrThrow({ where: { id: m.id }, include: { growthMember: true } })).toMatchObject({ status: "active", growthMember: { role: "sales", active: true } });
    expect(await employeeFromGoogle(g("g-meena", "meena@gmail.com"))).toBe("/staff/employee?google=ok");
    expect((await getStaff())?.email).toBe("meena@gmail.com");
  });

  it("a Google profile left 'invited' by an earlier approval signs in with Google and is activated", async () => {
    const u = await db.staffUser.create({ data: { empNo: "T-020", name: "Sumit Test", email: "sumit.t@gmail.com", kind: "team", phone: "9822010020", role: "sales", status: "invited", googleSub: "g-sumit", approvedBy: "Aarti Admin" } });
    expect(await employeeFromGoogle(g("g-sumit", "sumit.t@gmail.com"))).toBe("/staff/employee?google=ok");
    expect(await db.staffUser.findUniqueOrThrow({ where: { id: u.id }, include: { growthMember: true } })).toMatchObject({ status: "active", inviteTokenHash: null, growthMember: { role: "sales" } });
    expect((await getStaff())?.email).toBe("sumit.t@gmail.com");
  });
});
