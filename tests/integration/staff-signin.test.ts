import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined), set: (k: string, v: string) => jar.set(k, v), delete: (k: string | { name: string }) => jar.delete(typeof k === "string" ? k : k.name) }),
  headers: async () => new Headers({ "x-forwarded-for": "10.0.0.12", "user-agent": "vitest" }),
}));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error("redirect " + u); } }));

import { db } from "@/server/db";
import { hashPassword } from "@/server/auth";
import { getStaff } from "@/staff/auth";
import { getMe } from "@/staff/hrms/auth";
import { signIn } from "@/staff/signin";
import type { StaffRoleId } from "@/staff/constants";
import { resetDb } from "./helpers";

const mk = async (empNo: string, email: string, kind: "team" | "partner", role: StaffRoleId, pw: string) =>
  db.staffUser.create({ data: { empNo, name: email.split("@")[0], email, kind, phone: "9822" + String(Math.floor(Math.random() * 1e6)).padStart(6, "0"), role, status: "active", passwordHash: await hashPassword(pw), referralCode: role === "partner" || role === "sales" ? "R" + Math.random().toString(36).slice(2, 8).toUpperCase() : null } });

describe("one staff sign-in for partners, team and employees", () => {
  beforeAll(async () => {
    await resetDb();
    await mk("MS-101", "admin@medoro.in", "team", "super_admin", "admin team password");
    await mk("RP-201", "admin@medoro.in", "partner", "partner", "admin partner password");
    await mk("RP-202", "mr@gmail.com", "partner", "partner", "mr partner password");
    await mk("MS-102", "emp@medoro.in", "team", "employee", "employee password 1");
    await mk("MS-103", "sam@medoro.in", "team", "sales", "sales password 12");
  });
  beforeEach(async () => { jar.clear(); await db.loginAttempt.deleteMany(); });

  it("a partner's email and password open the partner dashboard", async () => {
    expect(await signIn("MR@gmail.com", "mr partner password")).toEqual({ next: "done", to: "/staff" });
    expect(await getStaff()).toMatchObject({ role: "partner", email: "mr@gmail.com" });
  });

  it("a super admin's team password asks for the authenticator; the partner password on the same email opens the partner profile", async () => {
    expect(await signIn("admin@medoro.in", "admin team password")).toEqual({ next: "enroll" });
    expect(await getStaff()).toBeNull(); // not until the authenticator code
    jar.clear();
    expect(await signIn("admin@medoro.in", "admin partner password")).toEqual({ next: "done", to: "/staff" });
    expect(await getStaff()).toMatchObject({ role: "partner", email: "admin@medoro.in" });
  });

  it("employees and sales sign in to the HRMS with email or employee ID", async () => {
    expect(await signIn("emp@medoro.in", "employee password 1")).toEqual({ next: "done", to: "/staff/hrms" });
    expect(await getMe()).toMatchObject({ email: "emp@medoro.in" });
    jar.clear();
    expect(await signIn("ms-102", "employee password 1")).toEqual({ next: "done", to: "/staff/hrms" });
    jar.clear();
    expect(await signIn("sam@medoro.in", "sales password 12")).toEqual({ next: "done", to: "/staff/hrms" });
    expect(await getStaff()).toMatchObject({ role: "sales" }); // sales still reach their leads in the console
  });

  it("wrong passwords and unknown emails fail the same way, and lock", async () => {
    await expect(signIn("emp@medoro.in", "nope-nope-nope")).rejects.toThrow(/incorrect/);
    await expect(signIn("mr@gmail.com", "nope-nope-nope")).rejects.toThrow(/incorrect/);
    await expect(signIn("nobody@gmail.com", "nope-nope-nope")).rejects.toThrow(/incorrect/);
    for (let i = 0; i < 5; i++) await expect(signIn("mr@gmail.com", "nope-nope-nope")).rejects.toThrow();
    await expect(signIn("mr@gmail.com", "mr partner password")).rejects.toThrow(/Too many attempts/);
  });
});
