import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined), set: (k: string, v: string) => (v ? jar.set(k, v) : jar.delete(k)), delete: (k: string) => jar.delete(k) }),
  headers: async () => new Headers({ "x-forwarded-for": "10.0.0.9", "user-agent": "vitest" }),
}));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error("redirect " + u); } }));

import { db } from "@/server/db";
import { loadPerms, type Me } from "@/staff/hrms/auth";
import { assignWaiting, setSalesTerms, teamBoard } from "@/staff/hrms/leads";
import { resetDb } from "./helpers";

let hr: Me, sam: Me;
const mkMe = async (id: string): Promise<Me> => { const u = await db.staffUser.findUniqueOrThrow({ where: { id }, include: { hr: true } }); return { id, empNo: u.empNo, name: u.name, first: u.name.split(" ")[0], email: u.email, staffRole: u.role, role: u.hr!.role, perms: await loadPerms(), sessionId: "t", phone: u.phone, personalEmail: "", dept: "", designation: "", photo: null, mustChangePassword: false, profileDone: true, docsAccepted: true, kycSubmitted: true, kycSkipped: false, kycVerified: true }; };
const mk = (n: number, name: string, role: "super_admin" | "employee" | "sales", hrRole: "admin" | "employee" | "sales") =>
  db.staffUser.create({ data: { empNo: `MS-40${n}`, name, email: `${name.split(" ")[0].toLowerCase()}@medoro.in`, kind: "team", phone: `98600000${n}0`, role, status: "active", referralCode: role === "sales" ? "SS" + n : null, hr: { create: { role: hrRole, profileDone: true, docsAcceptedAt: new Date() } } } });

const waiting = (n: number) => db.lead.createMany({ data: Array.from({ length: n }, (_, i) => ({ code: `Q-${i}`, name: `Quota Chemist ${i}`, owner: "—", phone: `98770000${String(i).padStart(2, "0")}`, city: "—", source: "Field visit", product: "starter", stage: "new", staffId: "" })) });

beforeAll(async () => {
  await resetDb();
  process.env.SESSION_SECRET ||= "test-only-secret-0123456789abcdef0123";
  hr = await mkMe((await mk(1, "Asha Admin", "super_admin", "admin")).id);
  sam = await mkMe((await mk(3, "Sam Sales", "sales", "sales")).id);
});
beforeEach(() => jar.clear());

describe("monthly lead quota", () => {
  it("starts at 100 a month for every salesperson", async () => {
    const row = (await teamBoard()).find((t) => t.id === sam.id)!;
    expect(row.quota).toBe(100);
    expect(row.givenMonth).toBe(0);
  });
  it("auto-assign stops at the quota and holds the rest back", async () => {
    await setSalesTerms(hr, sam.id, { target: 40, pct: 0, quota: 2 });
    await waiting(3);
    const r = await assignWaiting();
    expect(r).toMatchObject({ given: 2, capped: 1 });
    expect(await db.lead.count({ where: { staffId: sam.id } })).toBe(2);
    expect(await db.lead.count({ where: { staffId: "" } })).toBe(1);
    expect((await teamBoard()).find((t) => t.id === sam.id)!.givenMonth).toBe(2);
  });
  it("HR raising the quota lets the waiting lead go out", async () => {
    await setSalesTerms(hr, sam.id, { target: 40, pct: 0, quota: 5 });
    expect(await assignWaiting()).toMatchObject({ given: 1, capped: 0 });
    expect(await db.lead.count({ where: { staffId: "" } })).toBe(0);
  });
  it("rejects a negative quota", async () => {
    await expect(setSalesTerms(hr, sam.id, { target: 40, pct: 0, quota: -1 })).rejects.toThrow(/can’t be negative/);
  });
});
