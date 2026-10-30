import "server-only";
import { db, type Tx } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorize, authorizeAny, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { dateOnly, daysTo, hhmm, dayMonth, todayISO } from "@/lib/dates";
import { postGrn } from "@/domain/purchasing/service";
import { big, inr } from "@/lib/money";
import { isSellable } from "./fefo";
import { sellableByMedicine, velocity } from "./queries";
import { medicineSchema, receiveSchema, type MedicineInput, type ReceiveInput } from "./contracts";

export type InvFilter = "all" | "low" | "rx" | "exp";

export async function listInventory(ctx: Ctx, q: string, filter: InvFilter) {
  const today = todayISO();
  const term = q.trim();
  const meds = await db.medicine.findMany({
    where: {
      tenantId: ctx.tenantId, active: true,
      ...(term ? { OR: [{ name: { contains: term, mode: "insensitive" } }, { generic: { contains: term, mode: "insensitive" } }, { manufacturer: { contains: term, mode: "insensitive" } }, { barcode: { startsWith: term } }] } : {}),
      ...(filter === "rx" ? { schedule: { not: null } } : {}),
    },
    orderBy: { name: "asc" },
    include: { batches: { where: { branchId: ctx.branchId, qtyAvailable: { gt: 0 } }, select: { id: true, medicineId: true, expiryDate: true, qtyAvailable: true, status: true } } },
  });
  const total = await db.medicine.count({ where: { tenantId: ctx.tenantId, active: true } });
  const rows = meds.map((m) => {
    const sellable = m.batches.filter((b) => isSellable(b, today)).reduce((a, b) => a + b.qtyAvailable, 0);
    const blocked = m.batches.filter((b) => !isSellable(b, today)).length;
    const near = m.batches.filter((b) => daysTo(b.expiryDate, today) > 0).sort((a, b) => +a.expiryDate - +b.expiryDate)[0];
    const soonest = m.batches.length ? Math.min(...m.batches.map((b) => daysTo(b.expiryDate, today))) : null;
    return {
      id: m.id, name: m.name, meta: `${m.generic} · ${m.strength} · ${m.form}`, manufacturer: m.manufacturer, sellable, reorder: m.reorderLevel,
      batches: m.batches.length, blocked, nearExpiry: near ? near.expiryDate.toISOString().slice(0, 10) : null, nearDays: near ? daysTo(near.expiryDate, today) : null,
      mrp: big(m.mrpPaise), gst: m.gstRate, schedule: m.schedule, soonest,
    };
  }).filter((r) => filter === "low" ? r.sellable < r.reorder : filter === "exp" ? r.soonest != null && r.soonest <= 90 : true);
  return { rows, total };
}

export async function medicineDetail(ctx: Ctx, id: string) {
  const m = await db.medicine.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!m) return null;
  const today = todayISO();
  const [batches, moves, vel, suppliers] = await Promise.all([
    db.batch.findMany({ where: { tenantId: ctx.tenantId, branchId: ctx.branchId, medicineId: id }, include: { supplier: { select: { name: true } } }, orderBy: [{ expiryDate: "asc" }, { batchNo: "asc" }] }),
    db.stockMovement.findMany({ where: { tenantId: ctx.tenantId, branchId: ctx.branchId, batch: { medicineId: id } }, include: { batch: { select: { batchNo: true } } }, orderBy: { at: "desc" }, take: 25 }),
    velocity(ctx.tenantId, ctx.branchId),
    db.supplier.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const users = await db.user.findMany({ where: { tenantId: ctx.tenantId, id: { in: [...new Set(moves.map((x) => x.userId))] } }, select: { id: true, name: true } });
  return {
    medicine: {
      id: m.id, name: m.name, generic: m.generic, strength: m.strength, form: m.form, manufacturer: m.manufacturer, pack: m.pack,
      barcode: m.barcode, hsn: m.hsn, gstRate: m.gstRate, mrp: big(m.mrpPaise), schedule: m.schedule ?? "", reorderLevel: m.reorderLevel, rack: m.rack ?? "", version: m.version,
    },
    sellable: batches.filter((b) => isSellable(b, today)).reduce((a, b) => a + b.qtyAvailable, 0),
    velocity: vel.get(id) ?? 0,
    batches: batches.map((b) => ({
      id: b.id, batchNo: b.batchNo, expiry: b.expiryDate.toISOString().slice(0, 10), days: daysTo(b.expiryDate, today), qty: b.qtyAvailable,
      cost: big(b.costPaise), mrp: big(b.mrpPaise), supplier: b.supplier?.name ?? "Opening stock", status: b.status, note: b.statusNote,
    })),
    moves: moves.map((x) => ({ id: x.id, when: dayMonth(x.at) + " " + hhmm(x.at), type: x.type, batchNo: x.batch.batchNo, qty: x.qty, ref: x.note ?? x.refType, by: users.find((u) => u.id === x.userId)?.name ?? "" })),
    suppliers,
  };
}

export async function createMedicine(ctx: Ctx, raw: MedicineInput) {
  return db.$transaction((tx) => createMedicineIn(tx, ctx, raw));
}

export async function createMedicineIn(tx: Tx, ctx: Ctx, raw: MedicineInput) {
  authorizeAny(ctx, "adjust", "purchase");
  const i = medicineSchema.parse(raw);
  if (i.barcode && (await tx.medicine.findFirst({ where: { tenantId: ctx.tenantId, barcode: i.barcode } }))) throw new UserError(`Barcode ${i.barcode} is already used by another medicine.`);
  const dup = await tx.medicine.findFirst({ where: { tenantId: ctx.tenantId, active: true, name: { equals: i.name, mode: "insensitive" }, strength: { equals: i.strength, mode: "insensitive" } } });
  if (dup) throw new UserError(`${dup.name} ${dup.strength} already exists.`);
  const m = await tx.medicine.create({
    data: {
      tenantId: ctx.tenantId, name: i.name, generic: i.generic, strength: i.strength, form: i.form, manufacturer: i.manufacturer,
      pack: i.pack || "1 unit", unitsPerPack: parseInt(i.pack) || 1, mrpPaise: BigInt(i.mrp), gstRate: i.gstRate, schedule: i.schedule || null,
      reorderLevel: i.reorderLevel, barcode: i.barcode || null, hsn: i.hsn, rack: i.rack || null,
    },
  });
  await writeAudit(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: "Medicine created", entity: "medicine", entityId: m.id, detail: `${m.name} · ${m.generic} ${m.strength}` });
  return m.id;
}

export async function updateMedicine(ctx: Ctx, id: string, version: number, raw: MedicineInput) {
  authorizeAny(ctx, "adjust", "purchase");
  const i = medicineSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const before = await tx.medicine.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!before) throw new UserError("Medicine not found.");
    if (i.barcode && (await tx.medicine.findFirst({ where: { tenantId: ctx.tenantId, barcode: i.barcode, NOT: { id } } }))) throw new UserError(`Barcode ${i.barcode} is already used by another medicine.`);
    // Optimistic concurrency: the update only applies to the version the user saw.
    const r = await tx.medicine.updateMany({
      where: { id, tenantId: ctx.tenantId, version },
      data: {
        name: i.name, generic: i.generic, strength: i.strength, form: i.form, manufacturer: i.manufacturer, pack: i.pack || "1 unit",
        mrpPaise: BigInt(i.mrp), gstRate: i.gstRate, schedule: i.schedule || null, reorderLevel: i.reorderLevel, barcode: i.barcode || null,
        hsn: i.hsn, rack: i.rack || null, version: { increment: 1 },
      },
    });
    if (!r.count) throw new UserError("Someone else changed this medicine. Reopen it and try again.");
    const changed = (["name", "generic", "strength", "gstRate", "schedule", "reorderLevel", "barcode"] as const).filter((k) => String(before[k] ?? "") !== String((i as Record<string, unknown>)[k] ?? ""));
    if (big(before.mrpPaise) !== i.mrp) changed.push("mrp" as never);
    await writeAudit(tx, {
      tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: "Medicine updated", entity: "medicine", entityId: id,
      detail: `${i.name}${changed.length ? " · " + changed.join(", ") : ""}${big(before.mrpPaise) !== i.mrp ? ` · MRP ${inr(big(before.mrpPaise))} → ${inr(i.mrp)}` : ""}`,
      before: { mrp: big(before.mrpPaise), gstRate: before.gstRate, schedule: before.schedule, reorderLevel: before.reorderLevel }, after: { mrp: i.mrp, gstRate: i.gstRate, schedule: i.schedule, reorderLevel: i.reorderLevel },
    });
  });
}

/** Receives a batch. With a supplier it posts a one-line GRN (payable, input GST, supplier bill). Cost is per pack excluding GST. */
export async function receiveBatch(ctx: Ctx, raw: ReceiveInput) {
  return db.$transaction((tx) => receiveBatchIn(tx, ctx, raw));
}

export async function receiveBatchIn(tx: Tx, ctx: Ctx, raw: ReceiveInput) {
  authorizeAny(ctx, "adjust", "purchase");
  const i = receiveSchema.parse(raw);
  if (daysTo(i.expiry) <= 0) throw new UserError("Expiry must be in the future. Expired stock can’t be received as sellable.");
  if (i.cost > i.mrp) throw new UserError("Cost is above MRP. Check the invoice.");
  if (i.supplierId && !i.invoiceNo) throw new UserError("Enter the supplier invoice number.");
  const m = await tx.medicine.findFirst({ where: { id: i.medicineId, tenantId: ctx.tenantId, active: true } });
  if (!m) throw new UserError("Medicine not found.");
  const exists = await tx.batch.findFirst({ where: { tenantId: ctx.tenantId, branchId: ctx.branchId, medicineId: m.id, batchNo: i.batchNo } });
  if (exists) throw new UserError(`Batch ${i.batchNo} already exists for ${m.name}. Use a stock adjustment to correct its quantity.`);
  if (i.supplierId) {
    const r = await postGrn(tx, ctx, { supplierId: i.supplierId, invoiceNo: i.invoiceNo, invoiceDate: todayISO(), statedTotal: null, poId: null, scanDocId: null,
      lines: [{ medicineId: m.id, batchNo: i.batchNo, expiry: i.expiry, qty: i.qty, freeQty: 0, rate: i.cost / 100, mrp: i.mrp / 100, poItemId: null }] });
    const b = await tx.batch.findFirstOrThrow({ where: { tenantId: ctx.tenantId, branchId: ctx.branchId, medicineId: m.id, batchNo: i.batchNo } });
    return { batchId: b.id, grnNo: r.grnNo };
  }
  const b = await tx.batch.create({
    data: { tenantId: ctx.tenantId, branchId: ctx.branchId, medicineId: m.id, batchNo: i.batchNo, expiryDate: dateOnly(i.expiry), qtyAvailable: i.qty, costPaise: BigInt(i.cost), mrpPaise: BigInt(i.mrp) },
  });
  await tx.stockMovement.create({ data: { tenantId: ctx.tenantId, branchId: ctx.branchId, batchId: b.id, qty: i.qty, type: "opening", refType: "opening", refId: b.id, userId: ctx.userId, note: "Opening stock" } });
  await writeAudit(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: "Opening stock entered", entity: "batch", entityId: b.id, detail: `${m.name} · ${i.batchNo} × ${i.qty}` });
  return { batchId: b.id, grnNo: null as string | null };
}

/** Quarantine blocks a batch from sale; release makes it sellable again. Logged as a zero-qty movement. */
export async function setQuarantine(ctx: Ctx, batchId: string, quarantine: boolean, note: string) {
  authorize(ctx, "adjust");
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Batch" WHERE id = ${batchId} AND "tenantId" = ${ctx.tenantId} FOR UPDATE`;
    if (!rows.length) throw new UserError("Batch not found.");
    const b = await tx.batch.findUniqueOrThrow({ where: { id: batchId }, include: { medicine: { select: { name: true } } } });
    if (quarantine && b.status !== "ok") throw new UserError("This batch is already blocked.");
    if (!quarantine && b.status !== "quarantine") throw new UserError("Only quarantined batches can be released.");
    if (!quarantine && b.statusNote?.startsWith("Recall")) authorize(ctx, "users");
    await tx.batch.update({ where: { id: batchId }, data: { status: quarantine ? "quarantine" : "ok", statusNote: quarantine ? note || "Manual quarantine" : null, version: { increment: 1 } } });
    await tx.stockMovement.create({ data: { tenantId: ctx.tenantId, branchId: b.branchId, batchId, qty: 0, type: quarantine ? "quarantine" : "release", refType: "manual", refId: batchId, userId: ctx.userId, note: note || (quarantine ? "Quarantined" : "Released") } });
    await writeAudit(tx, { tenantId: ctx.tenantId, branchId: b.branchId, userId: ctx.userId, userName: ctx.userName, action: quarantine ? "Batch quarantined" : "Batch released", entity: "batch", entityId: batchId, detail: `${b.medicine.name} · ${b.batchNo}${note ? " · " + note : ""}` });
  });
}

export { sellableByMedicine };
