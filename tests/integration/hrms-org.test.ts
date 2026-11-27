import { beforeAll, describe, expect, it, vi } from "vitest";

// Enterprise HRMS Phase 2: reporting lines are validated (no self, no loops, active managers), employment history is
// recorded for every change and is append-only, pay history is shown only to Payroll and the person, and the org
// chart follows the visibility rules.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers({ "x-forwarded-for": "10.0.0.9" }) }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error("redirect " + u); } }));

import { db } from "@/server/db";
import { loadPerms, type Me } from "@/staff/hrms/auth";
import { createEmployee, setEmployeeActive, updateEmployee } from "@/staff/hrms/people";
import { promote, applyDuePromotions } from "@/staff/hrms/promotions";
import { checkManager, managersAbove, orgChart, orgHealth, timeline } from "@/staff/hrms/org";
import { resetDb } from "./helpers";

let admin: Me, hr: Me, fin: Me;
const me = async (id: string): Promise<Me> => {
  const u = await db.staffUser.findUniqueOrThrow({ where: { id }, include: { hr: true } });
  return { id, empNo: u.empNo, name: u.name, first: u.name.split(" ")[0], email: u.email, staffRole: u.role, role: u.role === "super_admin" ? "admin" : u.hr!.role, perms: await loadPerms(), sessionId: "t", phone: u.phone, personalEmail: "", dept: u.hr!.dept, designation: "", photo: null, mustChangePassword: false, profileDone: true, docsAccepted: true, kycSubmitted: true, kycSkipped: false, kycVerified: true };
};
let n = 0;
const mkRaw = async (name: string, role: "super_admin" | "employee", hrRole: "admin" | "hr" | "employee" | "finance", extra: { dept?: string; managerId?: string | null } = {}) =>
  db.staffUser.create({ data: { empNo: `MS-${100 + ++n}`, name, email: `${name.split(" ")[0].toLowerCase()}${n}@medoro.in`, kind: "team", phone: "97000000" + String(n).padStart(2, "0"), role, status: "active", hr: { create: { role: hrRole, dept: extra.dept ?? "Ops", managerId: extra.managerId ?? null, ctc: 500000, joinDate: new Date("2025-01-06"), profileDone: true, docsAcceptedAt: new Date() } } } });
const base = { designation: "Executive", role: "employee" as const, empType: "Full-time" as const, location: "", ctc: 500000, incentivePct: 0, monthlyTarget: 40 };
const join = (name: string, phone: string, managerId: string | null, dept = "Ops") => createEmployee(hr, { name, personalEmail: `${name.split(" ")[0].toLowerCase()}@x.in`, phone, dept, designation: "Executive", role: "employee", empType: "Full-time", joinDate: "2026-11-02", ctc: 400000, location: "", managerId, incentivePct: 0 });

describe("HRMS organisation (Phase 2)", () => {
  let a: string, b: string, c: string, other: string;
  beforeAll(async () => {
    await resetDb();
    admin = await me((await mkRaw("Asha Admin", "super_admin", "admin")).id);
    hr = await me((await mkRaw("Hari HR", "employee", "hr", { dept: "HR" })).id);
    fin = await me((await mkRaw("Farah Finance", "employee", "finance", { dept: "Finance" })).id);
    a = (await mkRaw("Anil Head", "employee", "employee")).id;
    b = (await mkRaw("Bina Lead", "employee", "employee", { managerId: a })).id;
    c = (await mkRaw("Chetan Exec", "employee", "employee", { managerId: b })).id;
    other = (await mkRaw("Omar Other", "employee", "employee", { dept: "Sales" })).id;
  });

  it("walks the chain of managers", async () => {
    expect(await managersAbove(c)).toEqual([b, a]);
    expect(await managersAbove(a)).toEqual([]);
  });

  it("refuses self, loops, unknown and inactive managers on create, edit and promotion", async () => {
    await expect(checkManager(a, a)).rejects.toThrow(/themselves/);
    await expect(updateEmployee(hr, a, { ...base, dept: "Ops", managerId: c })).rejects.toThrow(/reports \(directly or further up\)/);
    await expect(updateEmployee(hr, a, { ...base, dept: "Ops", managerId: "no-such-person" })).rejects.toThrow(/employee list/);
    await expect(join("Ghost Report", "9811111101", "no-such-person")).rejects.toThrow(/employee list/);
    const gone = await mkRaw("Gita Gone", "employee", "employee");
    await db.staffUser.update({ where: { id: gone.id }, data: { status: "deactivated" } });
    await expect(updateEmployee(hr, c, { ...base, dept: "Ops", managerId: gone.id })).rejects.toThrow(/active employee/);
    await expect(promote(hr, a, { toDesig: "Director", toDept: "Ops", toManagerId: b, toCtc: 900000, effective: "2026-11-27", responsibilities: "", note: "" })).rejects.toThrow(/reports/);
    expect((await db.hrProfile.findUniqueOrThrow({ where: { staffId: a } })).managerId).toBeNull(); // nothing saved
  });

  it("records joining, edits, transfers and exits in an append-only history", async () => {
    const j = await join("Jaya Joiner", "9811111102", b);
    expect((await timeline(hr, j.id))[0]).toMatchObject({ type: "joined", by: "Hari HR" });
    await updateEmployee(hr, j.id, { ...base, dept: "Sales", managerId: other, ctc: 450000 });
    const t = await timeline(hr, j.id);
    expect(t[0]).toMatchObject({ type: "transfer", changes: { dept: ["Ops", "Sales"], managerId: ["Bina Lead", "Omar Other"], ctc: [400000, 450000] } });
    await setEmployeeActive(hr, j.id, false);
    expect((await timeline(hr, j.id))[0]).toMatchObject({ type: "exit", note: "Deactivated" });
    const ev = await db.hrEmploymentEvent.findFirstOrThrow({ where: { staffId: j.id } });
    await expect(db.hrEmploymentEvent.update({ where: { id: ev.id }, data: { note: "x" } })).rejects.toThrow(/append-only/);
    await expect(db.hrEmploymentEvent.delete({ where: { id: ev.id } })).rejects.toThrow(/append-only/);
  });

  it("records an applied promotion and keeps the old manager when the planned one became invalid", async () => {
    await promote(hr, c, { toDesig: "Senior Executive", toDept: "Ops", toManagerId: a, toCtc: 600000, effective: "2026-12-15", responsibilities: "", note: "" });
    // Before it takes effect, Anil starts reporting to Chetan: the planned line would now be a loop.
    await db.hrProfile.update({ where: { staffId: a }, data: { managerId: c } });
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      vi.setSystemTime(new Date("2026-12-16T06:00:00Z"));
      await applyDuePromotions(true);
    } finally { vi.useRealTimers(); }
    const p = await db.hrProfile.findUniqueOrThrow({ where: { staffId: c } });
    expect(p).toMatchObject({ designation: "Senior Executive", managerId: b, ctc: 600000 });
    expect((await timeline(hr, c))[0]).toMatchObject({ type: "promotion", effective: "2026-12-15" });
    await db.hrProfile.update({ where: { staffId: a }, data: { managerId: null } });
  });

  it("shows pay changes only to Payroll holders and the person; others need the Employees module", async () => {
    const asEmployees = { ...fin, role: "hr" as const, perms: { ...fin.perms, hr: ["employees"] as Me["perms"]["hr"] } }; // Employees without Payroll
    const t = await timeline(asEmployees, c);
    expect(t[0].changes.ctc).toBeUndefined();
    expect(t[0].hiddenPay).toBe(true);
    expect((await timeline(hr, c))[0].changes.ctc).toEqual([500000, 600000]);
    expect((await timeline(await me(c), c))[0].changes.ctc).toEqual([500000, 600000]);
    await expect(timeline(await me(b), c)).rejects.toThrow(/role can’t/);
  });

  it("the org chart follows the visibility rules", async () => {
    const all = await orgChart(hr);
    expect(all.nodes.map((x) => x.id)).not.toContain(admin.id); // the super admin is never shown to anyone else
    expect(all.nodes.find((x) => x.id === c)?.managerId).toBe(b);
    const mine = await orgChart(await me(other)); // Sales: sees their department and HR, not Ops
    const ids = mine.nodes.map((x) => x.id);
    expect(ids).toContain(other); expect(ids).toContain(hr.id); expect(ids).not.toContain(a);
    expect((await orgChart(admin)).nodes.map((x) => x.id)).toContain(admin.id);
  });

  it("organisation health lists people without a manager and managers who left", async () => {
    await db.staffUser.update({ where: { id: other }, data: { status: "deactivated" } });
    await db.hrProfile.update({ where: { staffId: b }, data: { managerId: other } });
    const h = await orgHealth(hr);
    expect(h.orphaned.map((x) => x.id)).toContain(b);
    expect(h.noManager.map((x) => x.id)).toContain(a);
    await expect(orgHealth(await me(c))).rejects.toThrow(/role can’t/);
  });
});
