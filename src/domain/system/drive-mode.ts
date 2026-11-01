import "server-only";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { UserError } from "@/server/action";
import { authorize, type Ctx } from "@/server/context";
import { big } from "@/lib/money";
import { isoOf } from "@/lib/dates";
import { maxDiscount } from "@/domain/sales/approval";

/**
 * "Drive mode" (DriveDB pilot): the pharmacy bills on each device's own database instead of the server.
 * Phase 1 is a pilot the owner turns on; the server keeps its copy until the move in Phase 7.
 */
export async function driveModeOn(tenantId: string): Promise<boolean> {
  const t = await db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true } });
  return (t.settings as { driveMode?: boolean }).driveMode === true;
}

const ownerOnly = (ctx: Ctx, what: string) => {
  authorize(ctx, "users");
  if (ctx.realRole !== "Owner" || ctx.role !== "Owner") throw new UserError(`Only the owner can ${what}.`);
};

export async function setDriveMode(ctx: Ctx, on: boolean) {
  ownerOnly(ctx, "turn Drive mode on or off");
  await db.$transaction(async (tx) => {
    const t = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { settings: true } });
    await tx.tenant.update({ where: { id: ctx.tenantId }, data: { settings: { ...(t.settings as object), driveMode: on } } });
    await writeAudit(tx, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: on ? "Drive mode turned on" : "Drive mode turned off", entity: "tenant", entityId: ctx.tenantId });
  });
  return on;
}

/**
 * This branch's catalogue, stock and customers, to load into a device database (same ids as here, so the
 * later move to Drive lines up). Only batches with stock are included; each comes in as opening stock.
 */
export async function deviceSeed(ctx: Ctx) {
  ownerOnly(ctx, "copy the catalogue to a device");
  if (!(await driveModeOn(ctx.tenantId))) throw new UserError("Turn on Drive mode first.");
  const [meds, batches, customers, branch, maxDiscountPct] = await Promise.all([
    db.medicine.findMany({ where: { tenantId: ctx.tenantId, active: true } }),
    db.batch.findMany({ where: { tenantId: ctx.tenantId, branchId: ctx.branchId, qtyAvailable: { gt: 0 } } }),
    db.customer.findMany({ where: { tenantId: ctx.tenantId, erasedAt: null } }),
    db.branch.findUniqueOrThrow({ where: { id: ctx.branchId }, select: { id: true, code: true, name: true } }),
    maxDiscount(ctx.tenantId),
  ]);
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Catalogue copied to a device", entity: "tenant", entityId: ctx.tenantId, detail: `${meds.length} medicines, ${batches.length} batches, ${customers.length} customers (${branch.name})` });
  return {
    branch, maxDiscountPct, userId: ctx.userId,
    medicines: meds.map((m) => ({
      id: m.id, name: m.name, generic: m.generic, strength: m.strength, form: m.form, manufacturer: m.manufacturer, barcode: m.barcode, hsn: m.hsn,
      gstRate: m.gstRate, mrpPaise: big(m.mrpPaise), schedule: m.schedule, packSize: m.packSize, packUnit: m.packUnit, looseUnit: m.looseUnit,
      allowLoose: m.allowLoose, reorderLevel: m.reorderLevel, rack: m.rack, composition: m.composition,
    })),
    batches: batches.map((b) => ({
      id: b.id, medicineId: b.medicineId, batchNo: b.batchNo, expiryDate: isoOf(b.expiryDate), costPaise: big(b.costPaise), mrpPaise: big(b.mrpPaise),
      // The device has no "damaged" state; damaged stock comes across blocked from sale, like quarantine.
      status: b.status === "damaged" ? "quarantine" : b.status, qty: b.qtyAvailable,
    })),
    customers: customers.map((c) => ({ id: c.id, name: c.name, phone: c.phone, gstin: c.gstin, creditLimitPaise: big(c.creditLimitPaise) })),
  };
}
export type DeviceSeed = Awaited<ReturnType<typeof deviceSeed>>;
