import "server-only";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorize, authorizeAny, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { big } from "@/lib/money";
import { todayISO } from "@/lib/dates";
import { discountCap } from "@/domain/identity/permissions";
import { fefoOrder, isSellable } from "@/domain/inventory/fefo";
import { commitSale, OFFLINE_MAX_DAYS } from "./service";
import type { SaleInput } from "./contracts";
import { opSchema, type OfflineOpInput, type OfflineSnapshot, type SyncResult } from "./offline-types";

export { opSchema, type OfflineOpInput, type OfflineSnapshot, type SyncResult };

/**
 * Offline billing (docs/ARCHITECTURE.md §5). A manager turns it on per device. The device keeps a
 * snapshot of medicines and a reserved share of each batch, bills from that while the network is down,
 * and sends the queued bills when it reconnects. The server rechecks everything before posting;
 * anything that no longer fits (stock, price, permission) becomes a conflict for a manager to settle.
 */

async function deviceFor(ctx: Ctx, deviceId: string) {
  const d = await db.device.findFirst({ where: { id: deviceId, tenantId: ctx.tenantId } });
  if (!d || !d.offline) throw new UserError("Offline billing is turned off for this device. Ask a manager to turn it on in Sync & offline.");
  if (d.branchId !== ctx.branchId) throw new UserError("This device bills for another branch. Switch branch first.");
  return d;
}

export async function enableDevice(ctx: Ctx, name: string) {
  authorizeAny(ctx, "users", "adjust");
  const label = name.trim().slice(0, 60) || ctx.counterName || "Counter";
  const d = await db.device.create({ data: { tenantId: ctx.tenantId, branchId: ctx.branchId, name: label, kind: "counter", offline: true } });
  await writeAudit(db, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: "Offline billing turned on", entity: "device", entityId: d.id, detail: `${label} · ${ctx.branchName}` });
  return { deviceId: d.id, name: label };
}

export async function disableDevice(ctx: Ctx, deviceId: string) {
  authorizeAny(ctx, "users", "adjust");
  const d = await db.device.findFirst({ where: { id: deviceId, tenantId: ctx.tenantId } });
  if (!d) throw new UserError("Device not found.");
  await db.device.update({ where: { id: d.id }, data: { offline: false, quota: {} } });
  await writeAudit(db, { tenantId: ctx.tenantId, branchId: d.branchId, userId: ctx.userId, userName: ctx.userName, action: "Offline billing turned off", entity: "device", entityId: d.id, detail: d.name });
}

/**
 * What the device needs to bill offline. Each offline device in the branch gets an equal share of
 * every sellable batch, leaving one share for the online counters, so two offline devices can't
 * both sell the last strip.
 */
export async function snapshot(ctx: Ctx, deviceId: string): Promise<OfflineSnapshot> {
  authorize(ctx, "sale");
  const dev = await deviceFor(ctx, deviceId);
  const today = todayISO();
  const [tenant, branch, devices, meds, batches] = await Promise.all([
    db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } }),
    db.branch.findUniqueOrThrow({ where: { id: ctx.branchId } }),
    db.device.count({ where: { tenantId: ctx.tenantId, branchId: ctx.branchId, offline: true } }),
    db.medicine.findMany({ where: { tenantId: ctx.tenantId, active: true }, orderBy: { name: "asc" } }),
    db.batch.findMany({ where: { tenantId: ctx.tenantId, branchId: ctx.branchId, status: "ok", qtyAvailable: { gt: 0 } } }),
  ]);
  const shares = devices + 1;
  const sellable = batches.filter((b) => isSellable(b, today));
  const quota: Record<string, number> = {};
  for (const b of sellable) quota[b.id] = Math.floor(b.qtyAvailable / shares);
  const takenAt = new Date();
  await db.device.update({ where: { id: dev.id }, data: { quota: { at: takenAt.toISOString(), batches: quota }, lastSeen: takenAt } });
  const withStock = new Set(sellable.filter((b) => quota[b.id] > 0).map((b) => b.medicineId));
  return {
    deviceId: dev.id, deviceName: dev.name, takenAt: takenAt.toISOString(), validDays: OFFLINE_MAX_DAYS,
    pharmacy: { name: tenant.name, branch: branch.name, address: branch.address, gstin: branch.gstin, dlNo: branch.drugLicence },
    cashier: ctx.userName, discCap: discountCap(ctx.perms),
    medicines: meds.filter((m) => withStock.has(m.id)).map((m) => ({ id: m.id, name: m.name, generic: m.generic, strength: m.strength, form: m.form, schedule: m.schedule, gstRate: m.gstRate, barcode: m.barcode })),
    batches: sellable.filter((b) => quota[b.id] > 0).map((b) => ({ id: b.id, medicineId: b.medicineId, batchNo: b.batchNo, expiry: b.expiryDate.toISOString().slice(0, 10), mrpPaise: big(b.mrpPaise), version: b.version, allowance: quota[b.id] })),
  };
}


const toSale = (op: OfflineOpInput, lines = op.sale.lines): SaleInput => ({
  idempotencyKey: op.id, lines, customerId: null, discountPct: op.sale.discountPct,
  pay: { mode: op.sale.pay.mode, tenderedPaise: op.sale.pay.tenderedPaise, ref: op.sale.pay.ref }, prescriber: op.sale.prescriber, rxNo: op.sale.rxNo,
});

/** Posts queued offline bills. Safe to resend: each bill posts once, keyed by its id. */
export async function syncOps(ctx: Ctx, deviceId: string, raw: unknown[]): Promise<SyncResult[]> {
  authorize(ctx, "sale");
  const dev = await deviceFor(ctx, deviceId);
  if (raw.length > 200) throw new UserError("Send at most 200 bills at a time.");
  const out: SyncResult[] = [];
  for (const r of raw) {
    const p = opSchema.safeParse(r);
    if (!p.success) { out.push({ id: String((r as { id?: unknown })?.id ?? "?"), status: "conflict", message: p.error.issues[0]?.message ?? "Unreadable bill." }); continue; }
    const op = p.data;
    const seen = await db.offlineOp.findUnique({ where: { id: op.id } });
    if (seen && seen.tenantId !== ctx.tenantId) { out.push({ id: op.id, status: "conflict", message: "Bill id clash." }); continue; }
    if (seen && seen.status !== "pending") { out.push(resultOf(seen)); continue; }
    if (!seen) {
      await db.offlineOp.create({ data: { id: op.id, tenantId: ctx.tenantId, deviceId: dev.id, kind: "sale", payload: op as object, baseVersion: op.baseVersion, status: "pending", createdAt: new Date(op.createdAt) } });
    }
    out.push(await post(ctx, op));
  }
  await db.device.update({ where: { id: dev.id }, data: { lastSeen: new Date() } });
  return out;
}

function resultOf(o: { id: string; status: string; conflict: unknown; resolution: string | null }): SyncResult {
  const c = (o.conflict ?? {}) as { message?: string; invoiceNo?: string };
  return o.status === "posted" || o.status === "resolved" ? { id: o.id, status: "posted", invoiceNo: c.invoiceNo, message: o.resolution ?? undefined } : { id: o.id, status: "conflict", message: c.message };
}

async function post(ctx: Ctx, op: OfflineOpInput, lines = op.sale.lines): Promise<SyncResult> {
  try {
    const r = await commitSale(ctx, toSale(op, lines), { at: new Date(op.createdAt) });
    const note = r.total !== op.sale.totalPaise ? `Posted at ${r.total / 100} (device showed ${op.sale.totalPaise / 100}).` : null;
    await db.offlineOp.update({ where: { id: op.id }, data: { status: "posted", conflict: { invoiceNo: r.invoiceNo, saleId: r.saleId, ...(note ? { message: note } : {}) } } });
    return { id: op.id, status: "posted", invoiceNo: r.invoiceNo, message: note ?? undefined };
  } catch (e) {
    if (!(e instanceof UserError)) throw e;
    await db.offlineOp.update({ where: { id: op.id }, data: { status: "conflict", conflict: { message: e.message } } });
    return { id: op.id, status: "conflict", message: e.message };
  }
}

/** A manager settles a conflict: post it from current stock (FEFO), or close it with a note. */
export async function resolveOp(ctx: Ctx, opId: string, action: "repost" | "close", note = "") {
  authorizeAny(ctx, "adjust", "users");
  const o = await db.offlineOp.findFirst({ where: { id: opId, tenantId: ctx.tenantId } });
  if (!o) throw new UserError("Offline bill not found.");
  if (o.status !== "conflict") throw new UserError("This bill is already settled.");
  if (action === "close") {
    if (note.trim().length < 3) throw new UserError("Say how it was settled (e.g. refunded the customer).");
    await db.offlineOp.update({ where: { id: o.id }, data: { status: "resolved", resolution: note.trim().slice(0, 200) } });
    await writeAudit(db, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: "Offline bill closed", entity: "offline_op", entityId: o.id, detail: note.trim().slice(0, 200) });
    return { status: "resolved" as const };
  }
  const op = opSchema.parse(o.payload);
  const dev = await db.device.findUnique({ where: { id: o.deviceId } });
  if (dev && dev.branchId !== ctx.branchId) throw new UserError("Switch to the branch this bill was made in, then post it.");
  // Same medicines and quantities, re-allocated across the batches that are sellable now.
  const day = todayISO(new Date(op.createdAt));
  const meds = [...new Set(op.sale.lines.map((l) => l.medicineId))];
  const batches = await db.batch.findMany({ where: { tenantId: ctx.tenantId, branchId: ctx.branchId, medicineId: { in: meds } } });
  const lines: SaleInput["lines"] = [];
  for (const m of meds) {
    let need = op.sale.lines.filter((l) => l.medicineId === m).reduce((a, l) => a + l.qty, 0);
    for (const b of fefoOrder(batches, m, day)) {
      if (need <= 0) break;
      const take = Math.min(need, b.qtyAvailable);
      lines.push({ medicineId: m, batchId: b.id, qty: take }); need -= take;
    }
    if (need > 0) throw new UserError("Not enough sellable stock now to post this bill. Receive stock first, or close it with a note.");
  }
  const r = await post(ctx, op, lines);
  if (r.status === "conflict") throw new UserError(r.message ?? "Couldn’t post this bill.");
  return { status: "posted" as const, invoiceNo: r.invoiceNo };
}

export async function offlineOverview(ctx: Ctx) {
  const [devices, ops] = await Promise.all([
    db.device.findMany({ where: { tenantId: ctx.tenantId, offline: true }, orderBy: { name: "asc" } }),
    db.offlineOp.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  return {
    devices: devices.map((d) => ({ id: d.id, name: d.name, branchId: d.branchId, lastSeen: d.lastSeen.toISOString() })),
    ops: ops.map((o) => {
      const p = opSchema.safeParse(o.payload);
      const c = (o.conflict ?? {}) as { message?: string; invoiceNo?: string };
      return { id: o.id, deviceId: o.deviceId, status: o.status, createdAt: o.createdAt.toISOString(), receivedAt: o.receivedAt.toISOString(), receipt: p.success ? p.data.receipt : "", totalPaise: p.success ? p.data.sale.totalPaise : 0, items: p.success ? p.data.sale.lines.reduce((a, l) => a + l.qty, 0) : 0, message: c.message ?? null, invoiceNo: c.invoiceNo ?? null, resolution: o.resolution };
    }),
  };
}
