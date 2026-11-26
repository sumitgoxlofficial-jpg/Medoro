import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined), set: (k: string, v: string) => (v ? jar.set(k, v) : jar.delete(k)), delete: (k: string) => jar.delete(k) }),
  headers: async () => new Headers({ "x-forwarded-for": "10.0.0.5", "user-agent": "vitest" }),
}));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error("redirect " + u); } }));

import { db } from "@/server/db";
import { loadPerms, type Me } from "@/staff/hrms/auth";
import { acknowledgeReview, closeCycle, cycleBoard, finalizeReview, myReviews, openCycle, submitManager, submitSelf } from "@/staff/hrms/appraisals";
import { addDays, todayISO } from "@/lib/dates";
import { seal } from "@/server/vault";
import { resetDb } from "./helpers";

let admin: Me, hr: Me, mgr: Me, emp: Me, solo: Me;
const mkMe = async (id: string): Promise<Me> => { const u = await db.staffUser.findUniqueOrThrow({ where: { id }, include: { hr: true } }); return { id, empNo: u.empNo, name: u.name, first: u.name.split(" ")[0], email: u.email, staffRole: u.role, role: u.hr!.role, perms: await loadPerms(), sessionId: "t", phone: u.phone, personalEmail: "", dept: "", designation: "", photo: null, mustChangePassword: false, profileDone: true, docsAccepted: true, kycSubmitted: true, kycSkipped: false, kycVerified: true }; };
const mk = (empNo: string, name: string, email: string, role: "super_admin" | "employee", hr: "admin" | "employee" | "finance" | "hr", managerId?: string) =>
  db.staffUser.create({ data: { empNo, name, email, kind: "team", phone: "982000000" + empNo.slice(-1), role, status: "active", hr: { create: { role: hr, managerId: managerId ?? null, ctc: 600000, joinDate: new Date("2026-01-05"), profileDone: true, docsAcceptedAt: new Date(), bankAccountSealed: new Uint8Array(seal("123456789012")), bankLast4: "9012", bankIfsc: "HDFC0001234", bankHolder: name } } } });

beforeAll(async () => {
  await resetDb();
  process.env.SESSION_SECRET ||= "test-only-secret-0123456789abcdef0123";
  admin = await mkMe((await mk("MS-001", "Asha Admin", "asha@medoro.in", "super_admin", "admin")).id);
  hr = await mkMe((await mk("MS-002", "Hari HR", "hari@medoro.in", "employee", "hr")).id);
  mgr = await mkMe((await mk("MS-003", "Manu Manager", "manu@medoro.in", "employee", "employee")).id);
  emp = await mkMe((await mk("MS-004", "Esha Employee", "esha@medoro.in", "employee", "employee", mgr.id)).id);
  solo = await mkMe((await mk("MS-005", "Sonu Solo", "sonu@medoro.in", "employee", "employee", admin.id)).id);
});
beforeEach(() => jar.clear());
const SELF = { rating: 4, achievements: "Closed 12 pharmacies and trained two new joiners.", challenges: "", goals: "Win 20 pharmacies next half." };
const MGR = { rating: 3, strengths: "Reliable and fast on calls.", improve: "Follow-ups on time.", comments: "" };

describe("performance appraisals", () => {
  let cycleId = "";
  const reviewOf = async (who: Me) => (await myReviews(who)).mine[0];
  it("HR opens a cycle for everyone except the super admin; only one open at a time", async () => {
    const c = { name: "H2 2026", periodFrom: "2026-07-01", periodTo: "2026-12-31", selfDue: addDays(todayISO(), 7), managerDue: addDays(todayISO(), 14) };
    await expect(openCycle(emp, c)).rejects.toThrow(/role can’t/);
    await expect(openCycle(hr, { ...c, managerDue: todayISO() })).rejects.toThrow(/after self-assessments/);
    cycleId = await openCycle(hr, c);
    await expect(openCycle(hr, c)).rejects.toThrow(/Close the open/);
    const b = await cycleBoard(hr);
    expect(b.reviews.map((r) => r.name).sort()).toEqual(["Esha Employee", "Hari HR", "Manu Manager", "Sonu Solo"]);
    expect(b.reviews.find((r) => r.name === "Sonu Solo")!.managerId).toBeNull(); // super-admin manager → HR step
    expect(b.reviews.find((r) => r.name === "Esha Employee")!.manager).toBe("Manu Manager");
  });
  it("self-assessment goes to the manager, who reviews; HR then finalises; the employee sees it and acknowledges", async () => {
    const r = await reviewOf(emp);
    await expect(submitSelf(emp, r.id, { ...SELF, achievements: "short" })).rejects.toThrow(/main achievements/);
    await expect(submitSelf(mgr, r.id, SELF)).rejects.toThrow(/not found/);
    await expect(submitManager(mgr, r.id, MGR)).rejects.toThrow(/Wait for their self-assessment/);
    await submitSelf(emp, r.id, SELF);
    await expect(submitSelf(emp, r.id, SELF)).rejects.toThrow(/already sent/);
    expect((await myReviews(mgr)).team.map((x) => x.name)).toEqual(["Esha Employee"]);
    await expect(finalizeReview(hr, r.id, { rating: 3, note: "" })).rejects.toThrow(/manager’s review first/);
    await expect(submitManager(solo, r.id, MGR)).rejects.toThrow(/not found/);
    await submitManager(mgr, r.id, MGR);
    // Before HR finishes, the employee doesn't see the manager's rating.
    expect(await reviewOf(emp)).toMatchObject({ status: "hr", mgrRating: null, finalRating: null });
    await expect(acknowledgeReview(emp, r.id)).rejects.toThrow(/hasn’t finished/);
    await expect(finalizeReview(emp, r.id, { rating: 3, note: "" })).rejects.toThrow(/role can’t/);
    await finalizeReview(hr, r.id, { rating: 4, note: "Great half. Keep it up." });
    expect(await reviewOf(emp)).toMatchObject({ status: "done", mgrRating: 3, finalRating: 4, hrNote: "Great half. Keep it up." });
    await acknowledgeReview(emp, r.id);
    expect((await reviewOf(emp)).ackAt).not.toBeNull();
  });
  it("someone without a usable manager goes straight to HR; HR can't finalise their own review; closing locks the cycle", async () => {
    const s = await reviewOf(solo);
    await submitSelf(solo, s.id, SELF);
    expect((await reviewOf(solo)).status).toBe("hr");
    const own = await reviewOf(hr);
    await submitSelf(hr, own.id, SELF);
    await expect(finalizeReview(hr, own.id, { rating: 5, note: "" })).rejects.toThrow(/Someone else/);
    await closeCycle(hr, cycleId);
    await expect(finalizeReview(hr, s.id, { rating: 3, note: "" })).rejects.toThrow(/closed/);
    const m = await reviewOf(mgr);
    await expect(submitSelf(mgr, m.id, SELF)).rejects.toThrow(/closed/);
  });
});
