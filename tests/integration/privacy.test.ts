import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { eraseCustomer, fullExport, getPrivacy, savePrivacy } from "@/domain/system/privacy";
import { saveCustomer } from "@/domain/parties/service";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

describe("privacy", () => {
  beforeAll(async () => { await resetDb(); await makePharmacy(); });

  it("strict mode and remote AI exclude each other; owner only", async () => {
    const ctx = await ctxFor();
    expect((await getPrivacy(ctx.tenantId)).strict).toBe(true);
    const p = await savePrivacy(ctx, { remoteAi: true });
    expect(p).toMatchObject({ remoteAi: true, strict: false });
    expect(await savePrivacy(ctx, { strict: true })).toMatchObject({ remoteAi: false, strict: true });
    await expect(savePrivacy(await ctxFor("Manager"), { telemetry: true })).rejects.toThrow(/role/);
  });

  it("erasure needs a zero balance and keeps the record anonymised", async () => {
    const ctx = await ctxFor();
    const owing = await saveCustomer(ctx, null, { name: "Owes Money", phone: "9822000002", waOptIn: true, creditLimit: "1000", opening: "50" });
    await expect(eraseCustomer(ctx, owing)).rejects.toThrow(/outstanding/);
    const clean = await saveCustomer(ctx, null, { name: "Ramesh K", phone: "9822000003", waOptIn: true, creditLimit: "0" });
    const other = await db.waMessage.create({ data: { tenantId: ctx.tenantId, invoiceId: "s-other", invoiceNo: "INV/2", recipient: "9822000009", idempotencyKey: "wa:s-other", status: "sent" } });
    const msg = await db.waMessage.create({ data: { tenantId: ctx.tenantId, invoiceId: "s-1", invoiceNo: "INV/1", recipient: "9822000003", idempotencyKey: "wa:s-1", status: "sent" } });
    await eraseCustomer(ctx, clean);
    const c = await db.customer.findUniqueOrThrow({ where: { id: clean } });
    expect(c.name).toMatch(/^Erased customer/); expect(c.phone).toBeNull(); expect(c.waOptIn).toBe(false);
    expect((await db.waMessage.findUniqueOrThrow({ where: { id: msg.id } })).recipient).toBe("erased");
    expect((await db.waMessage.findUniqueOrThrow({ where: { id: other.id } })).recipient).toBe("9822000009");
    const ex = await fullExport(ctx);
    expect(ex.customers).toHaveLength(2);
    expect(JSON.stringify(ex.users, (_, v) => (typeof v === "bigint" ? Number(v) : v))).not.toMatch(/argon2/);
    expect(ex.invites.length).toBeGreaterThan(0);
    expect(ex.invites[0]).not.toHaveProperty("code");
    expect(ex.subscription).not.toHaveProperty("licenceToken");
    expect(ex).toHaveProperty("scanDocuments"); expect(ex).toHaveProperty("heldCarts"); expect(ex).toHaveProperty("supportGrants");
  });
});
