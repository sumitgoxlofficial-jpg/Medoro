import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { inviteEmployee, issueReset, listTeam, roleMatrix, saveBranch, togglePermission, updateMember, verifyAudit } from "@/domain/identity/admin";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

describe("team and roles", () => {
  beforeAll(async () => { await resetDb(); await makePharmacy(); });

  it("invites, permissions and member changes", async () => {
    const ctx = await ctxFor();
    const inv = await inviteEmployee(ctx, { name: "Rahul Patil", contact: "98500 11003", role: "Pharmacist", branchId: null });
    expect(inv.tenantCode).toBe("TEST-PUNE");
    await expect(inviteEmployee(ctx, { name: "Mona Shah", contact: "9850011004", role: "Manager", branchId: null })).rejects.toThrow(/by email/);
    await expect(inviteEmployee(await ctxFor("Manager"), { name: "X Y", contact: "x@y.in", role: "Cashier", branchId: null })).rejects.toThrow(/role/);
    expect((await listTeam(ctx)).invites).toHaveLength(2); // setup invite + this one

    const roles = await roleMatrix(ctx);
    const owner = roles.find((r) => r.name === "Owner")!, cashier = roles.find((r) => r.name === "Cashier")!;
    await expect(togglePermission(ctx, owner.id, "sale")).rejects.toThrow(/locked/);
    expect(await togglePermission(ctx, cashier.id, "disc")).toBe(true);
    expect((await db.role.findUniqueOrThrow({ where: { id: cashier.id } })).permissions).toContain("disc");

    await expect(updateMember(ctx, ctx.userId, { active: false })).rejects.toThrow(/your own/);
    const t = await db.tenant.findFirstOrThrow();
    const u = await db.user.create({ data: { tenantId: t.id, name: "Sneha", phone: "9850021877", roleId: cashier.id, employeeNo: "E-102" } });
    await updateMember(ctx, u.id, { role: "Pharmacist", active: false });
    const after = await db.user.findUniqueOrThrow({ where: { id: u.id }, include: { role: true } });
    expect(after.role.name).toBe("Pharmacist"); expect(after.active).toBe(false); expect(after.tokenVersion).toBe(1);
    const r = await issueReset(ctx, u.id);
    expect((await db.invite.findFirstOrThrow({ where: { code: r.code } })).userId).toBe(u.id);
  });

  it("switching between PIN and password roles needs the new credential", async () => {
    const ctx = await ctxFor();
    const t = await db.tenant.findFirstOrThrow();
    const cashier = await db.role.findFirstOrThrow({ where: { tenantId: t.id, name: "Cashier" } });
    const u = await db.user.create({ data: { tenantId: t.id, name: "Kiran", email: "kiran@test.in", phone: "9850021999", roleId: cashier.id, employeeNo: "E-150", pinHash: "x" } });
    await expect(updateMember(ctx, u.id, { role: "Manager" })).rejects.toThrow(/Set a password/);
    await expect(updateMember(ctx, u.id, { role: "Manager", password: "short" })).rejects.toThrow(/10 characters/);
    await updateMember(ctx, u.id, { role: "Manager", password: "a-long-password" });
    let after = await db.user.findUniqueOrThrow({ where: { id: u.id }, include: { role: true } });
    expect(after.role.name).toBe("Manager"); expect(after.mfaRequired).toBe(true);
    expect(after.passwordHash).toBeTruthy(); expect(after.pinHash).toBeNull();

    await expect(updateMember(ctx, u.id, { role: "Cashier" })).rejects.toThrow(/PIN/);
    await expect(updateMember(ctx, u.id, { role: "Cashier", pin: "1234" })).rejects.toThrow(/easy/);
    await updateMember(ctx, u.id, { role: "Cashier", pin: "4826" });
    after = await db.user.findUniqueOrThrow({ where: { id: u.id }, include: { role: true } });
    expect(after.role.name).toBe("Cashier"); expect(after.mfaRequired).toBe(false);
    expect(after.pinHash).toBeTruthy(); expect(after.passwordHash).toBeNull();
    await updateMember(ctx, u.id, { role: "Pharmacist" }); // PIN role to PIN role: no new credential needed
  });

  it("branches and audit chain", async () => {
    const ctx = await ctxFor();
    await saveBranch(ctx, null, { name: "Aundh", address: "DP Road" });
    expect((await db.branch.findFirstOrThrow({ where: { name: "Aundh" } })).code).toBe("AUN");
    await expect(saveBranch(ctx, null, { name: "aundh" })).rejects.toThrow(/exists/);
    const v = await verifyAudit(ctx);
    expect(v.ok).toBe(true);
    expect(v.count).toBeGreaterThanOrEqual(3);
  });
});
