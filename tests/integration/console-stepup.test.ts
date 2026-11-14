import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined), set: (k: string, v: string) => jar.set(k, v), delete: (k: string | { name: string }) => jar.delete(typeof k === "string" ? k : k.name) }),
  headers: async () => new Headers({ "x-forwarded-for": "10.0.0.14", "user-agent": "vitest" }),
}));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error("redirect " + u); } }));

import { db } from "@/server/db";
import { hashPassword } from "@/server/auth";
import { getStaff, readStaffSession, requireStaff } from "@/staff/auth";
import { consoleStepUp, getMe, signIn } from "@/staff/hrms/auth";
import { signIn as partnerSignIn } from "@/staff/people";
import type { StaffRoleId } from "@/staff/constants";
import { resetDb } from "./helpers";

const PW = "long-enough-password-1";
const mk = async (empNo: string, email: string, role: StaffRoleId) =>
  db.staffUser.create({ data: { empNo, name: email.split("@")[0], email, kind: "team", phone: "98220" + empNo.replace(/\D/g, "").padStart(5, "0"), role, status: "active", passwordHash: await hashPassword(PW) } });

describe("Medoro team signs in on the HRMS; admins step up to the console", () => {
  beforeAll(async () => {
    await resetDb();
    await mk("MS-301", "boss@medoro.in", "super_admin");
    await mk("MS-302", "worker@medoro.in", "employee");
  });
  beforeEach(() => jar.clear());

  it("the partner sign-in turns team emails away to the HRMS", async () => {
    await expect(partnerSignIn("boss@medoro.in", PW, "partner")).rejects.toThrow(/Medoro team email/);
  });

  it("a super admin's HRMS session asks for the authenticator before the console opens", async () => {
    expect((await signIn("boss@medoro.in", PW)).next).toBe("done");
    const me = (await getMe())!;
    expect(await getStaff()).toBeNull();
    await expect(requireStaff()).rejects.toThrow("redirect /staff/hrms"); // not the partner sign-in
    expect(await consoleStepUp(me)).toBe("/staff/login");
    const s = await readStaffSession(true);
    expect(s).toMatchObject({ kind: "console", mfaPassed: false, staffId: me.id });
    expect(await getStaff()).toBeNull(); // until the code
  });

  it("employees don't get the console", async () => {
    await signIn("MS-302", PW);
    await expect(consoleStepUp((await getMe())!)).rejects.toThrow(/doesn’t use the staff console/);
  });
});
