import { beforeAll, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined),
    set: (k: string, v: string) => (v ? jar.set(k, v) : jar.delete(k)),
    delete: (k: string) => jar.delete(k),
  }),
  headers: async () => new Headers({ "user-agent": "vitest" }),
}));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error("redirect " + u); } }));

import { db } from "@/server/db";
import { hashPassword } from "@/server/auth";
import { passwordSignIn } from "@/app/(auth)/actions";
import { makePharmacy, resetDb } from "./helpers";

const EMAIL = "sumit@test.in";
const lastSessionUser = async () => (await db.session.findFirstOrThrow({ orderBy: { createdAt: "desc" } })).userId;

describe("one email, accounts in two pharmacies", () => {
  let ownerId = "", managerId = "";
  beforeAll(async () => {
    await resetDb();
    // Sumit owns pharmacy A, and was added earlier as a manager at pharmacy B with a different password.
    await makePharmacy({ owner: { name: "Sumit", email: EMAIL, phone: "9822000012", password: "owner-pw-12345" } });
    ownerId = (await db.user.findFirstOrThrow({ where: { email: EMAIL } })).id;
    const b = await db.tenant.create({ data: { code: "OTHR-PUNE", name: "Other Pharmacy", settings: {} } });
    const role = await db.role.create({ data: { tenantId: b.id, name: "Manager", permissions: [] } });
    managerId = (await db.user.create({ data: { tenantId: b.id, name: "Sumit", email: EMAIL, roleId: role.id, passwordHash: await hashPassword("manager-pw-123"), mfaRequired: true, createdAt: new Date("2020-01-01") } })).id;
  });

  it("opens the account whose password was entered, not just the oldest", async () => {
    jar.clear();
    expect((await passwordSignIn(EMAIL, "owner-pw-12345")).ok).toBe(true);
    expect(await lastSessionUser()).toBe(ownerId);
    jar.clear();
    expect((await passwordSignIn(EMAIL, "manager-pw-123")).ok).toBe(true);
    expect(await lastSessionUser()).toBe(managerId);
    jar.clear();
    expect(await passwordSignIn(EMAIL, "wrong-password-1")).toMatchObject({ ok: false });
  });

  it("prefers the owner account when both share a password", async () => {
    await db.user.update({ where: { id: managerId }, data: { passwordHash: await hashPassword("owner-pw-12345") } });
    jar.clear();
    expect((await passwordSignIn(EMAIL, "owner-pw-12345")).ok).toBe(true);
    expect(await lastSessionUser()).toBe(ownerId);
  });
});
