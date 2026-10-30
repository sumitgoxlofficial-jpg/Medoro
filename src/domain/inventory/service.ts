import "server-only";
import { db, type Tx } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorize, authorizeAny, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { dateOnly, daysTo, hhmm, dayMonth, todayISO } from "@/lib/dates";
import { postGrn } from "@/domain/purchasing/service";
import { big, inr } from "@/lib/money";
import { postVoucher } from "@/domain/accounting/post";
import { ACC } from "@/domain/accounting/accounts";
import { isSellable } from "./fefo";
import { sellableByMedicine, velocity } from "./queries";
import { medicineSchema, receiveSchema, type MedicineInput, type ReceiveInput } from "./contracts";
import { compositionOf } from "./salts";
import { fmtQty, packLabel } from "@/lib/units";
import { branchRacks, substitutesFor } from "./catalog";

export type InvFilter = "all" | "low" | "rx" | "exp";

export async function listInventory(ctx: Ctx, q: string, filter: InvFilter, rack = "") {
  const today = todayISO();
  const term = q.trim();
  const rackTerm = rack.trim();
  const racks = await branchRacks(ctx.tenantId, ctx.branchId);
  const rackIds = rackTerm ? [...racks].filter(([, r]) => r.toLowerCase() === rackTerm.toLowerCase()).map(([id]) => id) : [];
  const meds = await db.medicine.findMany({
    where: {
      tenantId: ctx.tenantId, active: true,
      ...(term ? { OR: [{ name: { contains: term, mode: "insensitive" } }, { generic: { contains: term, mode: "insensitive" } }, { composition: { contains: term, mode: "insensitive" } }, { manufacturer: { contains: term, mode: "insensitive" } }, { barcode: { startsWith: term } }] } : {}),
      ...(filter === "rx" ? { schedule: { not: null } } : {}),
      // A branch rack overrides the catalogue rack: match the override, or the catalogue rack where there is none.
      ...(rackTerm ? { AND: [{ OR: [{ id: { in: rackIds } }, { rack: { equals: rackTerm, mode: "insensitive" as const }, id: { notIn: [...racks.keys()] } }] }] } : {}),
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
      id: m.id, name: m.name, meta: `${m.composition ?? `${m.generic} · ${m.strength}`} · ${m.form}`, manufacturer: m.manufacturer,
      sellable, sellableText: fmtQty(sellable, m), low: sellable < m.reorderLevel * m.packSize, reorder: m.reorderLevel,
      batches: m.batches.length, blocked, nearExpiry: near ? near.expiryDate.toISOString().slice(0, 10) : null, nearDays: near ? daysTo(near.expiryDate, today) : null,
      mrp: big(m.mrpPaise), gst: m.gstRate, schedule: m.schedule, soonest, rack: racks.get(m.id) ?? m.rack ?? null,
    };
  }).filter((r) => filter === "low" ? r.low : filter === "exp" ? r.soonest != null && r.soonest <= 90 : true);
  return { rows, total };
}

export async function medicineDetail(ctx: Ctx, id: string) {
  const m = await db.medicine.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!m) return null;
  const today = todayISO();
  const [batches, moves, vel, suppliers, branches, branchRack, substitutes] = await Promise.all([
    db.batch.findMany({ where: { tenantId: ctx.tenantId, branchId: ctx.branchId, medicineId: id }, include: { supplier: { select: { name: true } } }, orderBy: [{ expiryDate: "asc" }, { batchNo: "asc" }] }),
    db.stockMovement.findMany({ where: { tenantId: ctx.tenantId, branchId: ctx.branchId, batch: { medicineId: id } }, include: { batch: { select: { batchNo: true } } }, orderBy: { at: "desc" }, take: 25 }),
    velocity(ctx.tenantId, ctx.branchId),
    db.supplier.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.branch.findMany({ where: { tenantId: ctx.tenantId, active: true, NOT: { id: ctx.branchId } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.medicineRack.findUnique({ where: { branchId_medicineId: { branchId: ctx.branchId, medicineId: id } } }),
    substitutesFor(ctx, id),
  ]);
  const users = await db.user.findMany({ where: { tenantId: ctx.tenantId, id: { in: [...new Set(moves.map((x) => x.userId))] } }, select: { id: true, name: true } });
  const sellable = batches.filter((b) => isSellable(b, today)).reduce((a, b) => a + b.qtyAvailable, 0);
  const units = { packSize: m.packSize, packUnit: m.packUnit, looseUnit: m.looseUnit, allowLoose: m.allowLoose, caseSize: m.caseSize, caseUnit: m.caseUnit };
  return {
    medicine: {
      id: m.id, name: m.name, generic: m.generic, strength: m.strength, form: m.form, manufacturer: m.manufacturer, pack: m.pack,
      barcode: m.barcode, hsn: m.hsn, gstRate: m.gstRate, mrp: big(m.mrpPaise), schedule: m.schedule ?? "", reorderLevel: m.reorderLevel, rack: m.rack ?? "", version: m.version,
      composition: m.composition ?? "", ...units, packLabel: packLabel(units),
    },
    branchRack: branchRack?.rack ?? "",
    sellable, sellableText: fmtQty(sellable, m),
    velocity: vel.get(id) ?? 0,
    batches: batches.map((b) => ({
      id: b.id, batchNo: b.batchNo, expiry: b.expiryDate.toISOString().slice(0, 10), days: daysTo(b.expiryDate, today), qty: b.qtyAvailable, qtyText: fmtQty(b.qtyAvailable, m),
      cost: big(b.costPaise), mrp: big(b.mrpPaise), supplier: b.supplier?.name ?? "Opening stock", hasSupplier: !!b.supplierId, status: b.status, note: b.statusNote,
    })),
    moves: moves.map((x) => ({ id: x.id, when: dayMonth(x.at) + " " + hhmm(x.at), type: x.type, batchNo: x.batch.batchNo, qty: x.qty, qtyText: fmtQty(x.qty, m), ref: x.note ?? x.refType, by: users.find((u) => u.id === x.userId)?.name ?? "" })),
    suppliers, branches, substitutes,
  };
}

export async function createMedicine(ctx: Ctx, raw: MedicineInput) {
  return db.$transaction((tx) => createMedicineIn(tx, ctx, raw));
}

const unitFields = (i: ReturnType<typeof medicineSchema.parse>) => ({
  packSize: i.packSize, packUnit: i.packUnit, looseUnit: i.looseUnit, allowLoose: i.allowLoose && i.packSize > 1, caseSize: i.caseSize, caseUnit: i.caseUnit,
});

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
      ...compositionOf(i), ...unitFields(i),
    },
  });
  await writeAudit(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: "Medicine created", entity: "medicine", entityId: m.id, detail: `${m.name} · ${m.composition ?? `${m.generic} ${m.strength}`}${m.packSize > 1 ? ` · ${packLabel(m)}` : ""}` });
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
        hsn: i.hsn, rack: i.rack || null, ...compositionOf(i), ...unitFields(i), version: { increment: 1 },
      },
    });
    if (!r.count) throw new UserError("Someone else changed this medicine. Reopen it and try again.");
    const rescaled = i.packSize !== before.packSize ? await rescaleStock(tx, ctx, before, i.packSize, i.looseUnit) : 0;
    const after = compositionOf(i);
    const changed: string[] = (["name", "generic", "strength", "gstRate", "schedule", "reorderLevel", "barcode", "allowLoose"] as const).filter((k) => String(before[k] ?? "") !== String((i as Record<string, unknown>)[k] ?? ""));
    if ((before.composition ?? null) !== after.composition) changed.push("composition");
    if (big(before.mrpPaise) !== i.mrp) changed.push("mrp");
    await writeAudit(tx, {
      tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: "Medicine updated", entity: "medicine", entityId: id,
      detail: `${i.name}${changed.length ? " · " + changed.join(", ") : ""}${big(before.mrpPaise) !== i.mrp ? ` · MRP ${inr(big(before.mrpPaise))} → ${inr(i.mrp)}` : ""}${before.packSize !== i.packSize ? ` · pack size ${before.packSize} → ${i.packSize}${rescaled ? `, ${rescaled} batch${rescaled > 1 ? "es" : ""} rescaled` : ""}` : ""}`,
      before: { mrp: big(before.mrpPaise), gstRate: before.gstRate, schedule: before.schedule, reorderLevel: before.reorderLevel, packSize: before.packSize }, after: { mrp: i.mrp, gstRate: i.gstRate, schedule: i.schedule, reorderLevel: i.reorderLevel, packSize: i.packSize },
    });
  });
}

/**
 * A pack-size change re-expresses stock in the new unit. Batches hold stock units, so going from packs of
 * `from` units to packs of `to` units multiplies every batch by to/from (e.g. 1 → 15 turns 4 strips into 60
 * tabs). Each batch gets a "unit" movement for the difference, so the ledger still sums to the batch quantity.
 * Only whole multiples are allowed while stock exists; with no stock anywhere the size can change freely.
 */
async function rescaleStock(tx: Tx, ctx: Ctx, m: { id: string; name: string; packSize: number }, to: number, looseUnit: string) {
  const from = m.packSize;
  const ids = (await tx.batch.findMany({ where: { tenantId: ctx.tenantId, medicineId: m.id }, select: { id: true } })).map((b) => b.id);
  if (!ids.length) return 0;
  await tx.$queryRaw`SELECT id FROM "Batch" WHERE "tenantId" = ${ctx.tenantId} AND id = ANY(${ids}) ORDER BY id FOR UPDATE`;
  const open = await tx.transfer.count({ where: { tenantId: ctx.tenantId, batchId: { in: ids }, status: { in: ["pending", "in_transit"] } } });
  if (open) throw new UserError(`${m.name} has ${open} open transfer${open > 1 ? "s" : ""}. Receive or cancel ${open > 1 ? "them" : "it"} before changing the pack size.`);
  const batches = await tx.batch.findMany({ where: { id: { in: ids } } });
  const held = batches.filter((b) => b.qtyAvailable || b.qtyQuarantined);
  if (!held.length) return 0;
  if (to % from) throw new UserError(`${m.name} has stock counted in packs of ${from}. The new pack size must be a multiple of ${from}, or bring the stock to zero first.`);
  const k = to / from;
  for (const b of held) {
    await tx.batch.update({ where: { id: b.id }, data: { qtyAvailable: b.qtyAvailable * k, qtyQuarantined: b.qtyQuarantined * k, version: { increment: 1 } } });
    await tx.stockMovement.create({ data: { tenantId: ctx.tenantId, branchId: b.branchId, batchId: b.id, qty: b.qtyAvailable * (k - 1), type: "unit", refType: "medicine", refId: m.id, userId: ctx.userId, note: `Pack size ${from} → ${to}: ${b.qtyAvailable} → ${b.qtyAvailable * k} ${looseUnit}` } });
  }
  return held.length;
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
  if (exists) throw new UserError(`Batch ${i.batchNo} already exists for ${m.name}. Use Actions → Stock adjustment on that batch to correct its quantity.`);
  // Received in packs (or cases of packs); stock is kept in stock units.
  const packs = i.unit === "case" ? i.qty * m.caseSize : i.qty;
  const units = packs * m.packSize;
  if (i.supplierId) {
    const r = await postGrn(tx, ctx, { supplierId: i.supplierId, invoiceNo: i.invoiceNo, invoiceDate: todayISO(), statedTotal: null, poId: null, scanDocId: null,
      lines: [{ medicineId: m.id, batchNo: i.batchNo, expiry: i.expiry, qty: packs, freeQty: 0, rate: i.cost / 100, mrp: i.mrp / 100, poItemId: null }] });
    const b = await tx.batch.findFirstOrThrow({ where: { tenantId: ctx.tenantId, branchId: ctx.branchId, medicineId: m.id, batchNo: i.batchNo } });
    return { batchId: b.id, grnNo: r.grnNo, units, unitsText: fmtQty(units, m) };
  }
  const b = await tx.batch.create({
    data: { tenantId: ctx.tenantId, branchId: ctx.branchId, medicineId: m.id, batchNo: i.batchNo, expiryDate: dateOnly(i.expiry), qtyAvailable: units, costPaise: BigInt(i.cost), mrpPaise: BigInt(i.mrp) },
  });
  await tx.stockMovement.create({ data: { tenantId: ctx.tenantId, branchId: ctx.branchId, batchId: b.id, qty: units, type: "opening", refType: "opening", refId: b.id, userId: ctx.userId, note: "Opening stock" } });
  // Stock already on the shelves enters the books at cost against Opening balance equity.
  await postVoucher(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, type: "journal", userId: ctx.userId, refType: "opening_stock", refId: b.id, narration: `Opening stock · ${m.name} ${i.batchNo} × ${fmtQty(units, m)}`,
    lines: [{ account: ACC.inventory, dr: packs * i.cost }, { account: ACC.opening, cr: packs * i.cost }] });
  await writeAudit(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: "Opening stock entered", entity: "batch", entityId: b.id, detail: `${m.name} · ${i.batchNo} × ${fmtQty(units, m)}` });
  return { batchId: b.id, grnNo: null as string | null, units, unitsText: fmtQty(units, m) };
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
