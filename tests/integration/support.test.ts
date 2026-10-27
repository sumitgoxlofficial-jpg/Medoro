import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const jar = new Map<string, string>();
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: (k: string) => (jar.has(k) ? { value: jar.get(k) } : undefined), set: (k: string, v: string) => jar.set(k, v), delete: (k: string) => jar.delete(k) }),
  headers: async () => new Headers({ "x-forwarded-for": "203.0.113.7", "user-agent": "vitest" }),
}));
vi.mock("next/navigation", () => ({ redirect: (u: string) => { throw new Error("redirect " + u); } }));

import { db } from "@/server/db";
import { getCtx } from "@/server/context";
import { run } from "@/server/action";
import { grantInfo, grantSupport, redeemGrant, revokeSupport, supportStatus } from "@/domain/identity/support";
import { createMedicine } from "@/domain/inventory/service";
import { accountsOverview, periodOf } from "@/domain/accounting/service";
import { listTeam, roleMatrix } from "@/domain/identity/admin";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

const tokenOf = (link: string) => link.split("/support/")[1];

describe("owner-granted support access", () => {
  beforeAll(async () => { await resetDb(); await makePharmacy(); });
  beforeEach(() => jar.clear());

  it("only the owner can grant; the link works once and signs in read-only", async () => {
    await expect(grantSupport(await ctxFor("Manager"), { minutes: 60, reason: "TK-1182 printer" }, "https://p.example")).rejects.toThrow(/role/);
    const owner = await ctxFor();
    await expect(grantSupport(owner, { minutes: 30, reason: "x" }, "https://p.example")).rejects.toThrow(/1, 2 or 4 hours/);
    const g = await grantSupport(owner, { minutes: 120, reason: "TK-1182 printer" }, "https://p.example");
    expect(g.link).toMatch(/^https:\/\/p\.example\/support\/[\w-]{32}$/);
    expect(await grantInfo(tokenOf(g.link))).toMatchObject({ grantedBy: "Owner Person", reason: "TK-1182 printer" });

    await redeemGrant(tokenOf(g.link));
    const ctx = (await getCtx())!;
    expect(ctx).toMatchObject({ userName: "Medoro support", readOnly: true });
    expect(await db.session.findFirstOrThrow({ where: { userId: ctx.userId } })).toMatchObject({ device: "Medoro support (read-only)" });
    // Can look…
    await expect(accountsOverview(ctx, periodOf("month"))).resolves.toBeTruthy();
    // …but can't change anything, by any route.
    await expect(createMedicine(ctx, { name: "X", generic: "Y", strength: "1", form: "Tablet", manufacturer: "Z", pack: "1", mrp: "10", gstRate: 12, schedule: "", reorderLevel: 1, barcode: "", hsn: "3004", rack: "" })).rejects.toThrow(/read-only/);
    expect(await run(async () => "should not run")).toEqual({ ok: false, error: expect.stringMatching(/read-only/) });

    jar.clear();
    await expect(redeemGrant(tokenOf(g.link))).rejects.toThrow(/already used/);
    expect(await grantInfo(tokenOf(g.link))).toBeNull();
    expect((await listTeam(owner)).users.map((u) => u.name)).not.toContain("Medoro support");
    expect((await roleMatrix(owner)).some((r) => r.name.startsWith("Medoro support"))).toBe(false);
    expect(await db.auditEvent.count({ where: { action: { in: ["Support access granted", "Support session started"] } } })).toBe(2);
  });

  it("revoking ends the support session at once", async () => {
    const owner = await ctxFor();
    const g = await grantSupport(owner, { minutes: 60, reason: "TK-1190 backup" }, "https://p.example");
    await redeemGrant(tokenOf(g.link));
    expect((await getCtx())?.readOnly).toBe(true);
    await revokeSupport(owner);
    expect(await getCtx()).toBeNull();
    const s = await supportStatus(owner);
    expect(s[0]).toMatchObject({ active: false, revokedBy: "Owner Person" });
    expect(s[1].revokedBy).toBe("Owner Person (replaced)"); // the earlier grant was closed when this one was made
  });

  it("an expired link can't be used", async () => {
    const owner = await ctxFor();
    const g = await grantSupport(owner, { minutes: 60, reason: "TK-1200" }, "https://p.example");
    await db.supportGrant.updateMany({ where: { usedAt: null, revokedAt: null }, data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(redeemGrant(tokenOf(g.link))).rejects.toThrow(/expired/);
  });
});
