import { beforeAll, describe, expect, it, vi } from "vitest";

// Enterprise HRMS Phase 8: the management dashboard computes from records, hides small groups, shows payroll cost only
// to Payroll holders, and is audited.
vi.mock("next/headers", () => ({ cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }), headers: async () => new Headers({ "x-forwarded-for": "10.0.0.9" }) }));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error("redirect " + u); } }));

import { db } from "@/server/db";
import { loadPerms, type Me } from "@/staff/hrms/auth";
import { management, managementCsv } from "@/staff/hrms/mgmt";
import { dateOnly } from "@/lib/dates";
import { resetDb } from "./helpers";

const TODAY = "2026-11-27";
let hr: Me, emp: Me;
const me = async (id: string, role?: Me["role"]): Promise<Me> => {
  const u = await db.staffUser.findUniqueOrThrow({ where: { id }, include: { hr: true } });
  return { id, empNo: u.empNo, name: u.name, first: u.name, email: u.email, staffRole: u.role, role: role ?? u.hr!.role, perms: await loadPerms(), sessionId: "t", phone: u.phone, personalEmail: "", dept: "", designation: "", photo: null, mustChangePassword: false, profileDone: true, docsAccepted: true, kycSubmitted: true, kycSkipped: false, kycVerified: true };
};
let n = 0;
const mk = async (dept: string, join: string, exit: string | null = null, status: "active" | "deactivated" = "active", role: "hr" | "employee" = "employee") =>
  (await db.staffUser.create({ data: { empNo: `MS-${700 + ++n}`, name: `P${n}`, email: `p${n}@medoro.in`, kind: "team", phone: "91000000" + String(n).padStart(2, "0"), role: "employee", status, hr: { create: { role, dept, joinDate: dateOnly(join), exitDate: exit ? dateOnly(exit) : null, profileDone: true, ctc: 600000 } } } })).id;

describe("HRMS management dashboard (Phase 8)", () => {
  const ops: string[] = [];
  beforeAll(async () => {
    await resetDb();
    hr = await me(await mk("HR", "2024-01-01", null, "active", "hr"));
    for (let i = 0; i < 6; i++) ops.push(await mk("Ops", "2025-06-01"));
    const sales = await mk("Sales", "2026-11-03");
    await mk("Sales", "2025-01-01", "2026-03-31", "deactivated");
    emp = await me(ops[0]);
    const kpi = await db.hrKpi.create({ data: { name: "On time", dept: "Ops", metric: "tasks_on_time_pct", target: 90, createdBy: hr.id, updatedBy: hr.id } });
    const kpi2 = await db.hrKpi.create({ data: { name: "Sales", dept: "Sales", metric: "sales_won", target: 10, createdBy: hr.id, updatedBy: hr.id } });
    for (const [i, id] of ops.entries()) await db.hrKpiResult.create({ data: { kpiId: kpi.id, staffId: id, periodStart: dateOnly("2026-11-01"), periodEnd: dateOnly("2026-11-30"), value: 50 + i * 10, target: 90, weight: 10, score: 60 + i * 5, explanation: "x" } });
    await db.hrKpiResult.create({ data: { kpiId: kpi2.id, staffId: sales, periodStart: dateOnly("2026-11-01"), periodEnd: dateOnly("2026-11-30"), value: 9, target: 10, weight: 10, score: 90, explanation: "x" } });
    await db.hrAttendance.createMany({ data: [{ staffId: ops[0], day: dateOnly("2026-11-02"), inAt: new Date("2026-11-02T04:00:00Z"), status: "present" }, { staffId: ops[1], day: dateOnly("2026-11-02"), inAt: new Date("2026-11-02T05:00:00Z"), status: "late" }] });
    await db.hrPayslip.createMany({ data: ops.slice(0, 2).map((s) => ({ staffId: s, month: "2026-10", workDays: 26, basic: 1, hra: 1, special: 1, gross: 50000, pf: 0, esi: 0, pt: 0, tds: 0, net: 50000, status: "paid", runBy: hr.id })) });
  });

  it("computes headcount, joins, exits, attrition and attendance from records", async () => {
    const m = await management(hr, TODAY);
    expect(m.headcount).toBe(8);
    expect(m.trend.at(-1)).toMatchObject({ month: "2026-11", joined: 1, headcount: 8 });
    expect(m.trend.find((t) => t.month === "2026-03")).toMatchObject({ left: 1 });
    expect(m.attrition.exits12).toBe(1);
    expect(m.attendance).toMatchObject({ days: 2, latePct: 50 });
    expect(m.attrition.definition).toMatch(/average month-end headcount/);
  });

  it("hides department KPI averages under five people", async () => {
    const m = await management(hr, TODAY);
    expect(m.kpis.depts.find((d) => d.name === "Ops")).toMatchObject({ people: 6, avg: 73 }); // (60+65+70+75+80+85)/6 = 72.5
    expect(m.kpis.depts.find((d) => d.name === "Sales")).toMatchObject({ people: 1, avg: null });
  });

  it("shows payroll cost only with the Payroll module; employees can't open it; it is audited", async () => {
    expect((await management(hr, TODAY)).payroll).toMatchObject({ month: "2026-10", total: 100000, depts: [{ name: "Ops", gross: 100000, people: 2 }] });
    const reportsOnly = { ...hr, perms: { ...hr.perms, hr: ["reports"] as Me["perms"]["hr"] } };
    expect((await management(reportsOnly, TODAY)).payroll).toBeNull();
    await expect(management(emp, TODAY)).rejects.toThrow(/role can’t/);
    expect(await db.staffAudit.count({ where: { action: "HRMS · Management dashboard opened" } })).toBeGreaterThanOrEqual(3);
    const csv = await managementCsv(hr);
    expect(csv.text).toContain("Headcount (active),8");
    expect(csv.text).toContain("Sales,1,hidden");
  });
});
