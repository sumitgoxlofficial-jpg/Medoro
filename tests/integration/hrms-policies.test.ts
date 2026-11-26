import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined), set: (k: string, v: string) => (v ? jar.set(k, v) : jar.delete(k)), delete: (k: string) => jar.delete(k) }),
  headers: async () => new Headers({ "x-forwarded-for": "10.0.0.5", "user-agent": "vitest" }),
}));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error("redirect " + u); } }));

import { db } from "@/server/db";
import { loadPerms, type Me } from "@/staff/hrms/auth";
import { acknowledgePolicy, allPolicies, archivePolicy, myPolicies, policiesPending, remindPolicy, savePolicy } from "@/staff/hrms/policies";
import { seal } from "@/server/vault";
import { resetDb } from "./helpers";

let admin: Me, emp: Me, other: Me;
const mkMe = async (id: string): Promise<Me> => { const u = await db.staffUser.findUniqueOrThrow({ where: { id }, include: { hr: true } }); return { id, empNo: u.empNo, name: u.name, first: u.name.split(" ")[0], email: u.email, staffRole: u.role, role: u.hr!.role, perms: await loadPerms(), sessionId: "t", phone: u.phone, personalEmail: "", dept: "", designation: "", photo: null, mustChangePassword: false, profileDone: true, docsAccepted: true, kycSubmitted: true, kycSkipped: false, kycVerified: true }; };
const mk = (empNo: string, name: string, email: string, role: "super_admin" | "employee", hr: "admin" | "employee" | "finance") =>
  db.staffUser.create({ data: { empNo, name, email, kind: "team", phone: "982000000" + empNo.slice(-1), role, status: "active", hr: { create: { role: hr, ctc: 600000, joinDate: new Date("2026-01-05"), profileDone: true, docsAcceptedAt: new Date(), bankAccountSealed: new Uint8Array(seal("123456789012")), bankLast4: "9012", bankIfsc: "HDFC0001234", bankHolder: name } } } });

beforeAll(async () => {
  await resetDb();
  process.env.SESSION_SECRET ||= "test-only-secret-0123456789abcdef0123";
  admin = await mkMe((await mk("MS-001", "Asha Admin", "asha@medoro.in", "super_admin", "admin")).id);
  emp = await mkMe((await mk("MS-003", "Esha Employee", "esha@medoro.in", "employee", "employee")).id);
  other = await mkMe((await mk("MS-004", "Omar Other", "omar@medoro.in", "employee", "employee")).id);
});
beforeEach(() => jar.clear());
const notes = (id: string) => db.hrNotification.findMany({ where: { staffId: id }, orderBy: { createdAt: "asc" } }).then((r) => r.map((n) => n.text));
const LEAVE = { title: "Leave policy", category: "Leave" as const, body: "Apply for leave in the HRMS before you go.\n\n- 12 casual days\n- 12 sick days", mandatory: true, reack: false };

describe("company policies", () => {
  let id = "";
  it("HR publishes; everyone is told; employees can't publish", async () => {
    await expect(savePolicy(emp, null, LEAVE)).rejects.toThrow(/role can’t/);
    await expect(savePolicy(admin, null, { ...LEAVE, body: "short" })).rejects.toThrow(/policy text/);
    id = await savePolicy(admin, null, LEAVE);
    expect((await notes(emp.id)).pop()).toMatch(/New company policy: Leave policy/);
    expect(await policiesPending(emp)).toBe(1);
  });
  it("an employee acknowledges; HR sees who has and hasn't", async () => {
    await acknowledgePolicy(emp, id);
    await acknowledgePolicy(emp, id); // twice is fine
    expect(await policiesPending(emp)).toBe(0);
    const p = (await allPolicies(admin)).find((x) => x.id === id)!;
    expect(p.acked.map((x) => x.name)).toEqual(["Esha Employee"]);
    expect(p.pending.map((x) => x.name).sort()).toEqual(["Asha Admin", "Omar Other"]);
    await expect(allPolicies(emp)).rejects.toThrow(/role can’t/);
  });
  it("a small edit keeps acknowledgements; an important change asks everyone again", async () => {
    await savePolicy(admin, id, { ...LEAVE, body: LEAVE.body + "\n\nTypo fixed." });
    expect((await myPolicies(emp))[0]).toMatchObject({ version: 1, acked: true });
    await savePolicy(admin, id, { ...LEAVE, body: LEAVE.body + "\n\n- 15 privilege days", reack: true });
    expect((await myPolicies(emp))[0]).toMatchObject({ version: 2, acked: false, ackedBefore: true });
    expect((await notes(emp.id)).pop()).toMatch(/was updated/);
  });
  it("HR reminds only people who haven't acknowledged; archived policies disappear", async () => {
    await acknowledgePolicy(emp, id);
    const before = (await notes(emp.id)).length;
    expect(await remindPolicy(admin, id)).toBe(1); // Omar (the admin doesn't remind themselves)
    expect((await notes(other.id)).pop()).toMatch(/Reminder/);
    expect((await notes(emp.id)).length).toBe(before);
    await archivePolicy(admin, id, true);
    expect(await myPolicies(emp)).toEqual([]);
    await expect(acknowledgePolicy(other, id)).rejects.toThrow(/isn’t in the handbook/);
    await archivePolicy(admin, id, false);
    expect(await policiesPending(other)).toBe(1);
  });
});
