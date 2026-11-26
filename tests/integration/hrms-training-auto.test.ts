import { beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
  headers: async () => new Headers({ "x-forwarded-for": "10.0.0.10", "user-agent": "vitest" }),
}));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error("redirect " + u); } }));

import { db } from "@/server/db";
import { loadPerms, type Me } from "@/staff/hrms/auth";
import * as tr from "@/staff/hrms/training/service";
import { RUBRICS } from "@/staff/hrms/training/shared";
import { resetDb } from "./helpers";

// The Sales Academy is automatic: the course installs itself and the sales team is enrolled without HR doing anything.
let hr: Me, salesRole: Me, salesDept: Me, ops: Me;
const mkMe = async (id: string): Promise<Me> => { const u = await db.staffUser.findUniqueOrThrow({ where: { id }, include: { hr: true } }); return { id, empNo: u.empNo, name: u.name, first: u.name.split(" ")[0], email: u.email, staffRole: u.role, role: u.hr!.role, perms: await loadPerms(true), sessionId: "t", phone: u.phone, personalEmail: "", dept: u.hr!.dept, designation: "", photo: null, mustChangePassword: false, profileDone: true, docsAccepted: true, kycSubmitted: true, kycSkipped: false, kycVerified: true }; };
const mk = (n: number, name: string, role: "employee" | "hr" | "sales", dept: string, status: "active" | "deactivated" = "active") =>
  db.staffUser.create({ data: { empNo: `MS-4${n}`, name, email: `${name.split(" ")[0].toLowerCase()}@medoro.in`, kind: "team", phone: `98420000${n}0`, role: role === "sales" ? "sales" : "employee", status, hr: { create: { role, dept, profileDone: true, docsAcceptedAt: new Date() } } } });

beforeAll(async () => {
  await resetDb();
  hr = await mkMe((await mk(1, "Hari HR", "hr", "HR")).id);
  salesRole = await mkMe((await mk(2, "Rahul Sales", "sales", "Field")).id);
  salesDept = await mkMe((await mk(3, "Neha Rep", "employee", "Sales")).id);
  ops = await mkMe((await mk(4, "Omkar Ops", "employee", "Operations")).id);
  await mk(5, "Gone Seller", "sales", "Sales", "deactivated");
});

describe("Sales Academy: automatic", () => {
  it("installs the course by itself, once, even when asked twice at the same moment", async () => {
    expect(await tr.programme()).toBeNull();
    await Promise.all([tr.ensureAcademy(), tr.ensureAcademy()]);
    expect(await db.trProgramme.count()).toBe(1);
    expect(await db.trLesson.count()).toBe(38);
    expect(await db.staffAudit.count({ where: { action: { contains: "installed automatically" } } })).toBe(1);
  });

  it("enrols a sales employee on their own first visit, and only sales staff", async () => {
    expect(tr.isSalesMe(salesRole)).toBe(true);
    expect(tr.isSalesMe(salesDept)).toBe(true);
    expect(tr.isSalesMe(ops)).toBe(false);
    expect(await tr.autoEnrol([salesRole.id])).toBe(1);
    expect(await tr.autoEnrol([salesRole.id])).toBe(0); // idempotent
    const mine = await tr.myTraining(salesRole);
    expect(mine?.batch).toMatchObject({ name: "Sales Academy · self-paced", selfPaced: true, isToday: true, trainer: "HR (no trainer set yet)" });
    expect(await db.hrNotification.count({ where: { staffId: salesRole.id, screen: "training" } })).toBe(1);
    expect(await tr.autoEnrol([ops.id])).toBe(0);
    expect(await tr.myTraining(ops)).toBeNull();
  });

  it("HR's academy enrols every active sales employee who isn't in yet, into the same self-paced batch", async () => {
    const a = await tr.academy(hr);
    if (!a.installed) throw new Error("not installed");
    expect(a.rows.map((r) => r.name).sort()).toEqual(["Neha Rep", "Rahul Sales"]); // not Ops, not the deactivated seller
    expect(new Set(a.rows.map((r) => r.batchId)).size).toBe(1);
    expect(a.batches).toHaveLength(1);
  });

  it("with no trainer, HR is told about practicals and scores them", async () => {
    const sc = await db.trScenario.findFirstOrThrow();
    await tr.submitPractical(salesRole, { kind: "mock_call", scenarioId: sc.id, submission: "Opened with permission, found the expiry problem, handled price honestly and booked a demo." });
    expect(await db.hrNotification.count({ where: { staffId: hr.id, screen: "academy" } })).toBe(1);
    const p = await db.trPractical.findFirstOrThrow();
    await tr.evaluatePractical(hr, p.id, Object.fromEntries(RUBRICS.mock_call.map((c) => [c.id, c.max])), "Clear and honest call, well done.");
    expect((await db.trPractical.findUniqueOrThrow({ where: { id: p.id } })).passed).toBe(true);
  });

  it("HR can switch automatic enrolment off, and later give the batch a trainer or take it away", async () => {
    await tr.saveTrainingSettings(hr, { ...(await tr.trainingSettings()), autoEnrol: false });
    const late = await mk(6, "Late Joiner", "sales", "Sales");
    expect(await tr.autoEnrol([late.id])).toBe(0);
    await tr.saveTrainingSettings(hr, { ...(await tr.trainingSettings()), autoEnrol: true });
    expect(await tr.autoEnrol([late.id])).toBe(1);

    const b = await db.trBatch.findFirstOrThrow();
    await tr.updateBatch(hr, b.id, { name: b.name, date: new Date().toISOString().slice(0, 10), trainerId: ops.id }, "scheduled");
    expect((await db.trBatch.findUniqueOrThrow({ where: { id: b.id } })).trainerId).toBe(ops.id);
    await tr.updateBatch(hr, b.id, { name: b.name, date: new Date().toISOString().slice(0, 10), trainerId: "" }, "scheduled");
    expect((await db.trBatch.findUniqueOrThrow({ where: { id: b.id } })).trainerId).toBe("");
    await expect(tr.createBatch(hr, { name: "Dated batch", date: "2026-12-01", trainerId: "" }, [])).rejects.toThrow(/Choose a trainer/);

    // Scheduling a dated batch moves people out of the self-paced batch, keeping their progress (the practical above).
    const before = await db.trAssignment.findFirstOrThrow({ where: { staffId: salesRole.id } });
    const dated = await tr.createBatch(hr, { name: "Dated batch", date: "2026-12-01", trainerId: ops.id }, [salesRole.id]);
    expect(dated.added).toEqual(["Rahul Sales"]);
    const after = await db.trAssignment.findFirstOrThrow({ where: { staffId: salesRole.id } });
    expect(after.id).toBe(before.id);
    expect(after.batchId).toBe(dated.id);
    expect(await db.trPractical.count({ where: { assignmentId: after.id } })).toBe(1);
    expect((await tr.assign(hr, b.id, [salesRole.id])).skipped[0].why).toBe("already assigned"); // not back out of a dated batch
    expect((await tr.myTraining(salesRole))?.batch).toMatchObject({ selfPaced: false, date: "2026-12-01" });
  });
});
