import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined), set: (k: string, v: string) => (v ? jar.set(k, v) : jar.delete(k)), delete: (k: string) => jar.delete(k) }),
  headers: async () => new Headers({ "x-forwarded-for": "10.0.0.5", "user-agent": "vitest" }),
}));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error("redirect " + u); } }));

import { db } from "@/server/db";
import { loadPerms, type Me } from "@/staff/hrms/auth";
import { docExpiryTick, expiringDocs, myDocs, setDocExpiry } from "@/staff/hrms/docs";
import { addDays, todayISO } from "@/lib/dates";
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
const doc = (staffId: string, kind: string, exp: string | null) => db.hrDocument.create({ data: { staffId, kind, name: kind + ".pdf", key: "k/" + kind, expiresOn: exp ? new Date(exp + "T00:00:00Z") : null } });
const notes = (id: string) => db.hrNotification.findMany({ where: { staffId: id }, orderBy: { createdAt: "asc" } }).then((r) => r.map((n) => n.text));

describe("document expiry", () => {
  it("the owner or HR sets the date; past dates are refused; others can't touch it", async () => {
    const d = await doc(emp.id, "Passport / photo ID", null);
    await setDocExpiry(emp, d.id, addDays(todayISO(), 200));
    expect((await myDocs(emp.id))[0]).toMatchObject({ expiresOn: addDays(todayISO(), 200), expiry: "valid" });
    await expect(setDocExpiry(emp, d.id, addDays(todayISO(), -1))).rejects.toThrow(/already expired/);
    await expect(setDocExpiry(other, d.id, addDays(todayISO(), 10))).rejects.toThrow(/not found/);
    await setDocExpiry(admin, d.id, addDays(todayISO(), 20));
    expect((await myDocs(emp.id))[0].expiry).toBe("soon");
    await setDocExpiry(emp, d.id, null);
    expect((await myDocs(emp.id))[0]).toMatchObject({ expiresOn: null, expiry: "" });
    await db.hrDocument.delete({ where: { id: d.id } });
  });
  it("reminds the employee and HR 30 and 7 days before and on expiry, once each; a new date starts again", async () => {
    const t0 = todayISO(), exp = addDays(t0, 25);
    const d = await doc(emp.id, "Passport / photo ID", exp);
    await db.hrDocument.update({ where: { id: d.id }, data: {} });
    expect(await docExpiryTick(t0)).toBe(1);               // within 30 days
    expect(await docExpiryTick(t0)).toBe(0);               // not twice
    expect(await docExpiryTick(addDays(exp, -7))).toBe(1); // 7 days before
    expect(await docExpiryTick(addDays(exp, -3))).toBe(0);
    expect(await docExpiryTick(addDays(exp, 1))).toBe(1);  // expired
    expect(await docExpiryTick(addDays(exp, 5))).toBe(0);
    const mine = await notes(emp.id);
    expect(mine).toHaveLength(3);
    expect(mine[0]).toMatch(/Your Passport \/ photo ID expires on/);
    expect(mine[2]).toMatch(/expired on/);
    expect((await notes(admin.id)).filter((x) => x.includes("Esha Employee’s Passport"))).toHaveLength(3);
    expect(await notes(other.id)).toEqual([]);
    await setDocExpiry(emp, d.id, addDays(t0, 10));          // renewed date: stages start again
    expect(await docExpiryTick(t0)).toBe(1);
  });
  it("people who have left get no reminders, and HR's list shows only active people's documents", async () => {
    await doc(other.id, "Address proof", addDays(todayISO(), 5));
    expect((await expiringDocs(admin)).map((x) => x.person)).toEqual(expect.arrayContaining(["Esha Employee", "Omar Other"]));
    expect(await expiringDocs(emp)).toEqual([]);
    await db.staffUser.update({ where: { id: other.id }, data: { status: "deactivated" } });
    const before = (await notes(other.id)).length;
    await docExpiryTick();
    expect((await notes(other.id)).length).toBe(before);
    expect((await expiringDocs(admin)).map((x) => x.person)).not.toContain("Omar Other");
  });
});
