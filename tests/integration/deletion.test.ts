import { beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { db } from "@/server/db";
import { createMedicine, receiveBatch } from "@/domain/inventory/service";
import { commitSale } from "@/domain/sales/service";
import { cancelDeletion, deletionPlan, deletionTick, purgeTenant, requestDeletion } from "@/domain/system/deletion";
import { addDays, todayISO } from "@/lib/dates";
import type { Ctx } from "@/server/context";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

describe("closing a pharmacy account", () => {
  let ctx: Ctx;
  let otherId = "";
  beforeAll(async () => {
    await resetDb();
    await makePharmacy();
    ctx = await ctxFor();
    // Real business data, including append-only tables (sale, stock movements, ledger).
    const med = await createMedicine(ctx, { name: "Dolo 650", generic: "Paracetamol", strength: "650 mg", form: "Tablet", manufacturer: "Micro Labs", pack: "15", mrp: "30", gstRate: 12, schedule: "", reorderLevel: 0, barcode: "", hsn: "3004", rack: "" });
    await receiveBatch(ctx, { medicineId: med, batchNo: "DL1", expiry: addDays(todayISO(), 300), qty: 10, cost: "20", mrp: "30", supplierId: null, invoiceNo: "" });
    const b = await db.batch.findFirstOrThrow({ where: { tenantId: ctx.tenantId } });
    await commitSale(ctx, { idempotencyKey: "k_" + randomUUID().replace(/-/g, ""), lines: [{ medicineId: med, batchId: b.id, qty: 1 }], customerId: null, discountPct: 0, pay: { mode: "cash" } });
    await db.onlinePayment.create({ data: { tenantId: ctx.tenantId, orderId: "order_del_1", paymentId: "pay_del_1", plan: "pro", cycle: "m", amountPaise: 249_900, gstPaise: 38_120, status: "paid", createdBy: ctx.userId, paidAt: new Date() } });
    // Another pharmacy on the same server must not be touched.
    const other = await makePharmacy({ pharmacy: { name: "Second Medical", code: "SECOND-PUNE", gstin: "", dl: "MH-9999", pharmacist: "", address: "Pune", lang: "en" }, owner: { name: "Second Owner", email: "second@test.in", phone: "9822000099", password: "long-enough-pw" }, invites: [] }, { signup: true });
    otherId = (await db.user.findUniqueOrThrow({ where: { id: other.ownerId } })).tenantId;
  });

  it("only the owner schedules it, after downloading and typing the pharmacy code; it can be cancelled", async () => {
    await expect(requestDeletion({ ...ctx, role: "Manager" }, { code: "TEST-PUNE", downloaded: true })).rejects.toThrow(/Only the pharmacy owner/);
    await expect(requestDeletion({ ...ctx, readOnly: true }, { code: "TEST-PUNE", downloaded: true })).rejects.toThrow(/support/);
    await expect(requestDeletion(ctx, { code: "TEST-PUNE", downloaded: false })).rejects.toThrow(/Download your data/);
    await expect(requestDeletion(ctx, { code: "WRONG", downloaded: true })).rejects.toThrow(/pharmacy code \(TEST-PUNE\)/);

    const now = new Date();
    const plan = await requestDeletion(ctx, { code: "test-pune", downloaded: true }, now);
    expect(new Date(plan.scheduledFor).getTime() - now.getTime()).toBe(7 * 86_400_000);
    expect(await deletionPlan(ctx.tenantId)).toMatchObject({ scheduledFor: plan.scheduledFor, by: ctx.userName });
    await expect(requestDeletion(ctx, { code: "TEST-PUNE", downloaded: true })).rejects.toThrow(/already scheduled/);
    expect(await db.auditEvent.count({ where: { tenantId: ctx.tenantId, action: "Pharmacy deletion scheduled" } })).toBe(1);

    // Nothing is deleted before the waiting period ends.
    expect(await deletionTick(new Date(now.getTime() + 6 * 86_400_000))).toBe(0);
    expect(await db.tenant.count({ where: { id: ctx.tenantId } })).toBe(1);

    await cancelDeletion(ctx);
    expect(await deletionPlan(ctx.tenantId)).toBeNull();
    await expect(cancelDeletion(ctx)).rejects.toThrow(/No deletion/);
  });

  it("after the wait, deletes every row of the pharmacy (append-only ledgers too) and keeps Medoro's payment records", async () => {
    const now = new Date();
    await requestDeletion(ctx, { code: "TEST-PUNE", downloaded: true }, now);
    expect(await db.sale.count({ where: { tenantId: ctx.tenantId } })).toBe(1);

    expect(await deletionTick(new Date(now.getTime() + 8 * 86_400_000))).toBe(1);

    expect(await db.tenant.count({ where: { id: ctx.tenantId } })).toBe(0);
    for (const n of await Promise.all([
      db.user.count({ where: { tenantId: ctx.tenantId } }), db.sale.count({ where: { tenantId: ctx.tenantId } }),
      db.stockMovement.count({ where: { tenantId: ctx.tenantId } }), db.auditEvent.count({ where: { tenantId: ctx.tenantId } }),
      db.medicine.count({ where: { tenantId: ctx.tenantId } }), db.subscriptionMeta.count({ where: { tenantId: ctx.tenantId } }),
      db.integration.count({ where: { tenantId: ctx.tenantId } }),
    ])) expect(n).toBe(0);
    // Medoro's own billing record stays, with a note of the deletion for its tax records.
    expect(await db.onlinePayment.count({ where: { tenantId: ctx.tenantId } })).toBe(1);
    expect((await db.staffAudit.findFirstOrThrow({ where: { action: "Pharmacy account deleted" } })).detail).toMatch(/Test Medical Store \(TEST-PUNE\).*1 online payment\(s\) kept, ₹2499\.00/);

    // The other pharmacy is untouched; running the job again does nothing.
    expect(await db.tenant.count({ where: { id: otherId } })).toBe(1);
    expect(await db.user.count({ where: { tenantId: otherId } })).toBe(1);
    expect(await deletionTick(new Date(now.getTime() + 9 * 86_400_000))).toBe(0);
    expect(await purgeTenant(ctx.tenantId)).toBe(false);
  });
});
