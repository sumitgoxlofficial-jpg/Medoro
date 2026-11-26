import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined), set: (k: string, v: string) => (v ? jar.set(k, v) : jar.delete(k)), delete: (k: string) => jar.delete(k) }),
  headers: async () => new Headers({ "x-forwarded-for": "10.0.0.5", "user-agent": "vitest" }),
}));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error("redirect " + u); } }));

import { db } from "@/server/db";
import { loadPerms, type Me } from "@/staff/hrms/auth";
import { decideResignation, exitsBoard, myExit, resign, saveInterview, tickClearance, withdrawResignation } from "@/staff/hrms/exits";
import { setEmployeeActive } from "@/staff/hrms/people";
import { addDays, todayISO } from "@/lib/dates";
import { seal } from "@/server/vault";
import { resetDb } from "./helpers";

let admin: Me, mgr: Me, emp: Me, other: Me;
const mkMe = async (id: string): Promise<Me> => { const u = await db.staffUser.findUniqueOrThrow({ where: { id }, include: { hr: true } }); return { id, empNo: u.empNo, name: u.name, first: u.name.split(" ")[0], email: u.email, staffRole: u.role, role: u.hr!.role, perms: await loadPerms(), sessionId: "t", phone: u.phone, personalEmail: "", dept: "", designation: "", photo: null, mustChangePassword: false, profileDone: true, docsAccepted: true, kycSubmitted: true, kycSkipped: false, kycVerified: true }; };
const mk = (empNo: string, name: string, email: string, role: "super_admin" | "employee", hr: "admin" | "employee" | "finance", managerId?: string) =>
  db.staffUser.create({ data: { empNo, name, email, kind: "team", phone: "982000000" + empNo.slice(-1), role, status: "active", hr: { create: { role: hr, managerId: managerId ?? null, ctc: 600000, joinDate: new Date("2026-01-05"), profileDone: true, docsAcceptedAt: new Date(), bankAccountSealed: new Uint8Array(seal("123456789012")), bankLast4: "9012", bankIfsc: "HDFC0001234", bankHolder: name } } } });

beforeAll(async () => {
  await resetDb();
  process.env.SESSION_SECRET ||= "test-only-secret-0123456789abcdef0123";
  admin = await mkMe((await mk("MS-001", "Asha Admin", "asha@medoro.in", "super_admin", "admin")).id);
  mgr = await mkMe((await mk("MS-002", "Manu Manager", "manu@medoro.in", "employee", "employee")).id);
  emp = await mkMe((await mk("MS-003", "Esha Employee", "esha@medoro.in", "employee", "employee", mgr.id)).id);
  other = await mkMe((await mk("MS-004", "Omar Other", "omar@medoro.in", "employee", "employee")).id);
});
beforeEach(() => jar.clear());
const notes = (id: string) => db.hrNotification.findMany({ where: { staffId: id } }).then((r) => r.map((n) => n.text).join(" | "));

describe("resignation", () => {
  it("an employee resigns, the manager and HR are told, and it can be withdrawn while pending", async () => {
    const day = addDays(todayISO(), 20);
    expect((await myExit(emp)).canResign).toBe(true);
    await expect(resign(emp, { reason: "short", lastDay: day })).rejects.toThrow(/a little about why/);
    await expect(resign(emp, { reason: "Moving to Pune for family reasons", lastDay: addDays(todayISO(), -1) })).rejects.toThrow(/past/);
    await resign(emp, { reason: "Moving to Pune for family reasons", lastDay: day });
    expect(await notes(mgr.id)).toMatch(/Esha Employee resigned.*shorter than the 30-day notice period/);
    expect(await notes(admin.id)).toMatch(/Esha Employee resigned/);
    expect(await notes(other.id)).toBe("");
    await expect(resign(emp, { reason: "Moving to Pune for family reasons", lastDay: day })).rejects.toThrow(/already have a resignation/);
    expect((await myExit(emp)).canResign).toBe(false);
    await withdrawResignation(emp);
    expect((await myExit(emp)).exit?.status).toBe("withdrawn");
    expect((await myExit(emp)).canResign).toBe(true);
  });
  it("only HR decides; declining needs a reason; accepting records the exit with the last working day", async () => {
    const day = addDays(todayISO(), 30);
    await resign(emp, { reason: "Got an offer closer to home", lastDay: day });
    const id = (await exitsBoard(admin)).requests[0].id;
    await expect(exitsBoard(emp)).rejects.toThrow(/role can’t/);
    await expect(decideResignation(mgr, id, { accept: true })).rejects.toThrow(/role can’t/);
    await expect(decideResignation(admin, id, { accept: false, note: "no" })).rejects.toThrow(/Say why/);
    const later = addDays(todayISO(), 35);
    await decideResignation(admin, id, { accept: true, lastDay: later, note: "All the best" });
    const p = await db.hrProfile.findUniqueOrThrow({ where: { staffId: emp.id } });
    expect(p.exitDate?.toISOString().slice(0, 10)).toBe(later);
    expect((await db.staffUser.findUniqueOrThrow({ where: { id: emp.id } })).status).toBe("active"); // still serving notice
    const mine = await myExit(emp);
    expect(mine.exit?.status).toBe("accepted");
    expect(mine.interviewOpen).toBe(true);
    expect(await notes(emp.id)).toMatch(/resignation was accepted/);
    await expect(decideResignation(admin, id, { accept: true })).rejects.toThrow(/already decided/);
  });
});

describe("exit interview and clearance", () => {
  it("the leaving employee fills the interview once; HR reads it and ticks clearance", async () => {
    await expect(saveInterview(other, { reason: "Pay" })).rejects.toThrow(/opens once/);
    await expect(saveInterview(emp, { liked: "Team" })).rejects.toThrow(/main reason/);
    await expect(saveInterview(emp, { reason: "Not a reason" })).rejects.toThrow(/Pick an answer/);
    await saveInterview(emp, { reason: "Relocation", liked: "Friendly team", manager: 4, recommend: "Yes" });
    await expect(saveInterview(emp, { reason: "Relocation" })).rejects.toThrow(/already sent/);
    expect((await myExit(emp)).interviewOpen).toBe(false);
    await tickClearance(admin, emp.id, "handover", true);
    await expect(tickClearance(admin, emp.id, "nonsense", true)).rejects.toThrow();
    await expect(tickClearance(emp, emp.id, "handover", true)).rejects.toThrow(/role can’t/);
    const row = (await exitsBoard(admin)).leaving.find((x) => x.staffId === emp.id)!;
    expect(row.resigned).toBe(true);
    expect(row.interview).toMatchObject({ reason: "Relocation", manager: 4 });
    expect(Object.keys(row.clearance)).toEqual(["handover"]);
    await tickClearance(admin, emp.id, "handover", false);
    expect(Object.keys((await exitsBoard(admin)).leaving.find((x) => x.staffId === emp.id)!.clearance)).toEqual([]);
  });
  it("an exit HR records directly gets clearance too, and cancelling the exit closes it", async () => {
    await setEmployeeActive(admin, other.id, false, addDays(todayISO(), 10));
    await tickClearance(admin, other.id, "assets", true);
    expect((await db.hrExit.findFirstOrThrow({ where: { staffId: other.id } })).status).toBe("recorded");
    await setEmployeeActive(admin, other.id, true);
    expect((await db.hrExit.findFirstOrThrow({ where: { staffId: other.id } })).status).toBe("cancelled");
    expect((await exitsBoard(admin)).leaving.find((x) => x.staffId === other.id)).toBeUndefined();
  });
});
