import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { verifyChain } from "@/lib/audit-hash";
import { makePharmacy, resetDb } from "./helpers";

describe("first-run setup", () => {
  beforeAll(resetDb);

  it("creates pharmacy, branches, counters, roles, owner and invites in one go", async () => {
    const r = await makePharmacy();
    expect(r.tenantCode).toBe("TEST-PUNE");
    expect(r.invites).toHaveLength(1);
    expect(r.invites[0].code).toMatch(/^[A-Z0-9]{4}-[A-Z0-9]{2}$/);
    const t = await db.tenant.findFirstOrThrow();
    expect(await db.branch.count({ where: { tenantId: t.id } })).toBe(2);
    expect(await db.counter.count({ where: { tenantId: t.id } })).toBe(3);
    expect(await db.role.count({ where: { tenantId: t.id } })).toBe(6);
    const owner = await db.user.findFirstOrThrow({ where: { tenantId: t.id }, include: { role: true } });
    expect(owner.role.name).toBe("Owner");
    expect(owner.mfaRequired).toBe(true);
    expect(owner.passwordHash).toMatch(/^\$argon2id\$/);
    const key = await db.integration.findFirstOrThrow({ where: { tenantId: t.id, kind: "backup_key" } });
    expect(Buffer.from(key.encryptedSecret!).includes(Buffer.from("A".repeat(43)))).toBe(false);
  });

  it("refuses a second setup on the same installation", async () => {
    await expect(makePharmacy({ pharmacy: { name: "Other", code: "OTHER", gstin: "", dl: "X-1", pharmacist: "", address: "", lang: "en" } }))
      .rejects.toThrow(/already set up/);
  });

  it("rejects a bad GSTIN and manager invites by phone", async () => {
    await resetDb();
    await expect(makePharmacy({ pharmacy: { name: "A", code: "AAAA", gstin: "27ABC", dl: "X-1", pharmacist: "", address: "", lang: "en" } })).rejects.toThrow(/GSTIN/);
    await expect(makePharmacy({ invites: [{ contact: "9850000003", role: "Manager" }] })).rejects.toThrow(/by email/);
    expect(await db.tenant.count()).toBe(0);
  });
});

describe("audit trail", () => {
  it("is hash-chained and append-only", async () => {
    await resetDb();
    await makePharmacy();
    const t = await db.tenant.findFirstOrThrow();
    await Promise.all(Array.from({ length: 8 }, (_, i) => writeAudit(db, { tenantId: t.id, action: "Concurrent " + i, entity: "test" })));
    const rows = await db.auditEvent.findMany({ where: { tenantId: t.id }, orderBy: { id: "asc" } });
    expect(rows).toHaveLength(9);
    expect(verifyChain(rows.map((r) => ({ ...r, at: r.at.toISOString() })))).toBe(-1);
    await expect(db.auditEvent.update({ where: { id: rows[0].id }, data: { detail: "tampered" } })).rejects.toThrow(/append-only/);
    await expect(db.auditEvent.delete({ where: { id: rows[0].id } })).rejects.toThrow(/append-only/);
  });
});
