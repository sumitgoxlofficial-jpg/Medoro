import "server-only";
import { z } from "zod";
import { db, type Tx } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorize, can, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { nextSeq, pad } from "@/server/sequence";
import { daysTo, fiscalYear } from "@/lib/dates";
import { big, inr } from "@/lib/money";
import { postVoucher } from "@/domain/accounting/post";
import { ACC } from "@/domain/accounting/accounts";

async function lockBatch(tx: Tx, ctx: Ctx, id: string) {
  const r = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Batch" WHERE id = ${id} AND "tenantId" = ${ctx.tenantId} FOR UPDATE`;
  if (!r.length) throw new UserError("Batch not found.");
  return tx.batch.findUniqueOrThrow({ where: { id }, include: { medicine: true, supplier: true } });
}

/** Return goods to the supplier: reduces stock and the payable, reverses input GST (debit note). */
export async function returnToSupplier(ctx: Ctx, batchId: string, qty: number, reason: string) {
  authorize(ctx, "purchase");
  if (!Number.isInteger(qty) || qty < 1) throw new UserError("Enter a quantity.");
  return db.$transaction(async (tx) => {
    const b = await lockBatch(tx, ctx, batchId);
    if (b.branchId !== ctx.branchId) throw new UserError("Return stock from the branch that holds it.");
    if (!b.supplier) throw new UserError("This batch has no supplier on record (opening stock). Write it off instead.");
    if (!b.supplier.acceptsReturns) throw new UserError(`${b.supplier.name} doesn’t accept returns.`);
    if (qty > b.qtyAvailable) throw new UserError(`Only ${b.qtyAvailable} in stock.`);
    const taxable = qty * big(b.costPaise), gst = Math.round((taxable * b.medicine.gstRate) / 100), half = Math.floor(gst / 2);
    const fy = fiscalYear();
    const no = `DN-${fy}-${pad(await nextSeq(tx, ctx.tenantId, "DN:" + fy))}`;
    await tx.batch.update({ where: { id: b.id }, data: { qtyAvailable: { decrement: qty }, version: { increment: 1 } } });
    const so = await tx.stockOut.create({ data: { tenantId: ctx.tenantId, branchId: ctx.branchId, no, kind: "supplier_return", supplierId: b.supplierId, batchId: b.id, qty, valuePaise: BigInt(taxable + gst), reason, userId: ctx.userId } });
    await tx.stockMovement.create({ data: { tenantId: ctx.tenantId, branchId: ctx.branchId, batchId: b.id, qty: -qty, type: "supplier_return", refType: "stock_out", refId: so.id, userId: ctx.userId, note: `${no} · ${reason}` } });
    await postVoucher(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, type: "debit_note", userId: ctx.userId, refType: "supplier_return", refId: so.id, narration: `${no} · return to ${b.supplier.name} · ${b.medicine.name} ${b.batchNo} × ${qty}`,
      lines: [{ account: ACC.creditors, dr: taxable + gst, partyType: "supplier", partyId: b.supplier.id }, { account: ACC.purchases, cr: taxable }, { account: ACC.inCgst, cr: half }, { account: ACC.inSgst, cr: gst - half }] });
    await writeAudit(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: `Debit note ${no}`, entity: "stock_out", entityId: so.id, detail: `${b.medicine.name} ${b.batchNo} × ${qty} → ${b.supplier.name} · ${inr(taxable + gst)}` });
    return no;
  });
}

/** Write off expired or damaged stock at cost (Stock loss). */
export async function writeOff(ctx: Ctx, batchId: string, qty: number, reason: string) {
  authorize(ctx, "adjust");
  if (!Number.isInteger(qty) || qty < 1) throw new UserError("Enter a quantity.");
  if (reason.trim().length < 3) throw new UserError("Enter the reason.");
  return db.$transaction(async (tx) => {
    const b = await lockBatch(tx, ctx, batchId);
    if (b.branchId !== ctx.branchId) throw new UserError("Write off stock at the branch that holds it.");
    if (qty > b.qtyAvailable) throw new UserError(`Only ${b.qtyAvailable} in stock.`);
    const value = qty * big(b.costPaise);
    const fy = fiscalYear();
    const no = `WO-${fy}-${pad(await nextSeq(tx, ctx.tenantId, "WO:" + fy))}`;
    await tx.batch.update({ where: { id: b.id }, data: { qtyAvailable: { decrement: qty }, version: { increment: 1 } } });
    const so = await tx.stockOut.create({ data: { tenantId: ctx.tenantId, branchId: ctx.branchId, no, kind: "write_off", batchId: b.id, qty, valuePaise: BigInt(value), reason, userId: ctx.userId } });
    await tx.stockMovement.create({ data: { tenantId: ctx.tenantId, branchId: ctx.branchId, batchId: b.id, qty: -qty, type: "write_off", refType: "stock_out", refId: so.id, userId: ctx.userId, note: `${no} · ${reason}` } });
    if (value) await postVoucher(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, type: "journal", userId: ctx.userId, refType: "write_off", refId: so.id, narration: `${no} · write-off ${b.medicine.name} ${b.batchNo} × ${qty} · ${reason}`,
      lines: [{ account: ACC.stockLoss, dr: value }, { account: ACC.inventory, cr: value }] });
    await writeAudit(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: `Stock written off ${no}`, entity: "stock_out", entityId: so.id, detail: `${b.medicine.name} ${b.batchNo} × ${qty} · ${inr(value)} · ${reason}${daysTo(b.expiryDate) <= 0 ? " · expired" : ""}` });
    return no;
  });
}

// ───────────── Transfers between branches ─────────────

export async function requestTransfer(ctx: Ctx, batchId: string, toBranch: string, qty: number, note = "") {
  authorize(ctx, "adjust");
  if (!Number.isInteger(qty) || qty < 1) throw new UserError("Enter a quantity.");
  if (toBranch === ctx.branchId) throw new UserError("Choose another branch.");
  return db.$transaction(async (tx) => {
    const b = await lockBatch(tx, ctx, batchId);
    if (b.branchId !== ctx.branchId) throw new UserError("Transfer from the branch that holds the stock.");
    if (!(await tx.branch.findFirst({ where: { id: toBranch, tenantId: ctx.tenantId, active: true } }))) throw new UserError("Branch not found.");
    if (b.status !== "ok" || daysTo(b.expiryDate) <= 0) throw new UserError("Blocked or expired stock can’t be transferred for sale.");
    if (qty > b.qtyAvailable) throw new UserError(`Only ${b.qtyAvailable} in stock.`);
    const no = `TR-${pad(await nextSeq(tx, ctx.tenantId, "TR"))}`;
    const t = await tx.transfer.create({ data: { tenantId: ctx.tenantId, no, fromBranch: ctx.branchId, toBranch, batchId, qty, status: "pending", createdBy: ctx.userId, note: note || null } });
    await writeAudit(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: "Transfer requested", entity: "transfer", entityId: t.id, detail: `${no} · ${b.medicine.name} ${b.batchNo} × ${qty}` });
    return no;
  });
}

/** Approve dispatch: stock leaves the source branch and is in transit. */
export async function approveTransfer(ctx: Ctx, id: string) {
  authorize(ctx, "adjust");
  return db.$transaction(async (tx) => {
    const t = await tx.transfer.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!t || t.status !== "pending") throw new UserError("Only pending transfers can be approved.");
    if (!ctx.branches.some((b) => b.id === t.fromBranch)) throw new UserError("You don’t have access to the sending branch.");
    // Owners/admins may approve their own request (single-person pharmacies); everyone else needs a second person.
    if (t.createdBy === ctx.userId && !can(ctx, "users")) throw new UserError("Someone other than the requester must approve this transfer.");
    const b = await lockBatch(tx, ctx, t.batchId);
    if (b.status !== "ok") throw new UserError(`${b.medicine.name} ${b.batchNo} is ${b.status === "quarantine" ? "quarantined" : b.status}${b.statusNote ? ` (${b.statusNote})` : ""}. Reject the transfer.`);
    if (daysTo(b.expiryDate) <= 0) throw new UserError(`${b.medicine.name} ${b.batchNo} has expired. Reject the transfer.`);
    if (b.qtyAvailable < t.qty) throw new UserError(`Only ${b.qtyAvailable} left in ${b.batchNo}. Edit or reject the transfer.`);
    await tx.batch.update({ where: { id: b.id }, data: { qtyAvailable: { decrement: t.qty }, version: { increment: 1 } } });
    await tx.stockMovement.create({ data: { tenantId: ctx.tenantId, branchId: t.fromBranch, batchId: b.id, qty: -t.qty, type: "transfer_out", refType: "transfer", refId: t.id, userId: ctx.userId, note: t.no } });
    if (!(await tx.transfer.updateMany({ where: { id, status: "pending" }, data: { status: "in_transit", approvedBy: ctx.userId, approvedAt: new Date() } })).count) throw new UserError("Only pending transfers can be approved.");
    await writeAudit(tx, { tenantId: ctx.tenantId, branchId: t.fromBranch, userId: ctx.userId, userName: ctx.userName, action: "Transfer approved", entity: "transfer", entityId: id, detail: `${t.no} · ${b.medicine.name} ${b.batchNo} × ${t.qty}` });
  });
}

/**
 * Receive at the destination: creates or tops up the same batch there. A block on the lot (quarantine/recall)
 * travels with it; returns a warning when the stock lands in a blocked batch.
 */
export async function receiveTransfer(ctx: Ctx, id: string): Promise<string | null> {
  authorize(ctx, "adjust");
  return db.$transaction(async (tx) => {
    const t = await tx.transfer.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!t || t.status !== "in_transit") throw new UserError("Only transfers in transit can be received.");
    if (!ctx.branches.some((b) => b.id === t.toBranch)) throw new UserError("You don’t have access to the receiving branch.");
    const src = await tx.batch.findUniqueOrThrow({ where: { id: t.batchId }, include: { medicine: true } });
    const existing = await tx.batch.findFirst({ where: { tenantId: ctx.tenantId, branchId: t.toBranch, medicineId: src.medicineId, batchNo: src.batchNo } });
    const block = src.status !== "ok" && existing?.status !== src.status ? { status: src.status, statusNote: src.statusNote ?? `Blocked at source (${t.no})` } : {};
    const dest = existing
      ? await tx.batch.update({ where: { id: existing.id }, data: { qtyAvailable: { increment: t.qty }, ...block, version: { increment: 1 } } })
      : await tx.batch.create({ data: { tenantId: ctx.tenantId, branchId: t.toBranch, medicineId: src.medicineId, batchNo: src.batchNo, expiryDate: src.expiryDate, mfgDate: src.mfgDate, qtyAvailable: t.qty, costPaise: src.costPaise, mrpPaise: src.mrpPaise, supplierId: src.supplierId, ...block } });
    await tx.stockMovement.create({ data: { tenantId: ctx.tenantId, branchId: t.toBranch, batchId: dest.id, qty: t.qty, type: "transfer_in", refType: "transfer", refId: t.id, userId: ctx.userId, note: t.no } });
    if (block.status) await tx.stockMovement.create({ data: { tenantId: ctx.tenantId, branchId: t.toBranch, batchId: dest.id, qty: 0, type: "quarantine", refType: "transfer", refId: t.id, userId: ctx.userId, note: `${t.no} · ${block.statusNote}` } });
    if (!(await tx.transfer.updateMany({ where: { id, status: "in_transit" }, data: { status: "received", receivedBy: ctx.userId, receivedAt: new Date() } })).count) throw new UserError("Only transfers in transit can be received.");
    await writeAudit(tx, { tenantId: ctx.tenantId, branchId: t.toBranch, userId: ctx.userId, userName: ctx.userName, action: "Transfer received", entity: "transfer", entityId: id, detail: `${t.no} · ${src.medicine.name} ${src.batchNo} × ${t.qty}${dest.status !== "ok" ? " · blocked: " + dest.status : ""}` });
    return dest.status === "ok" ? null : `Received, but ${src.medicine.name} ${src.batchNo} is ${dest.status === "quarantine" ? "quarantined" : dest.status} at this branch${dest.statusNote ? ` (${dest.statusNote})` : ""}. It stays blocked from sale.`;
  });
}

export async function rejectTransfer(ctx: Ctx, id: string) {
  authorize(ctx, "adjust");
  return db.$transaction(async (tx) => {
    const t = await tx.transfer.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!t || t.status !== "pending") throw new UserError("Only pending transfers can be rejected.");
    if (!ctx.branches.some((b) => b.id === t.fromBranch || b.id === t.toBranch)) throw new UserError("You don’t have access to either branch of this transfer.");
    const r = await tx.transfer.updateMany({ where: { id, status: "pending" }, data: { status: "rejected", approvedBy: ctx.userId, approvedAt: new Date() } });
    if (!r.count) throw new UserError("Only pending transfers can be rejected.");
    await writeAudit(tx, { tenantId: ctx.tenantId, branchId: t.fromBranch, userId: ctx.userId, userName: ctx.userName, action: "Transfer rejected", entity: "transfer", entityId: id, detail: t.no });
  });
}

/** Cancels a dispatched transfer: the stock goes back into the source batch. */
export async function cancelTransfer(ctx: Ctx, id: string) {
  authorize(ctx, "adjust");
  return db.$transaction(async (tx) => {
    const t = await tx.transfer.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!t || t.status !== "in_transit") throw new UserError("Only transfers in transit can be cancelled.");
    if (!ctx.branches.some((b) => b.id === t.fromBranch)) throw new UserError("You don’t have access to the sending branch.");
    const r = await tx.transfer.updateMany({ where: { id, status: "in_transit" }, data: { status: "cancelled" } });
    if (!r.count) throw new UserError("Only transfers in transit can be cancelled.");
    const b = await lockBatch(tx, ctx, t.batchId);
    await tx.batch.update({ where: { id: b.id }, data: { qtyAvailable: { increment: t.qty }, version: { increment: 1 } } });
    await tx.stockMovement.create({ data: { tenantId: ctx.tenantId, branchId: t.fromBranch, batchId: b.id, qty: t.qty, type: "transfer_in", refType: "transfer", refId: t.id, userId: ctx.userId, note: `${t.no} · cancelled` } });
    await writeAudit(tx, { tenantId: ctx.tenantId, branchId: t.fromBranch, userId: ctx.userId, userName: ctx.userName, action: "Transfer cancelled", entity: "transfer", entityId: id, detail: `${t.no} · ${b.medicine.name} ${b.batchNo} × ${t.qty} returned to stock` });
  });
}

// ───────────── Stock count ─────────────

export const countSchema = z.object({ lines: z.array(z.object({ batchId: z.string().uuid(), counted: z.number().int().min(0) })).min(1, "Enter counted quantities first."), note: z.string().max(200).default("") });

/**
 * Posts a physical count. Each adjustment is counted − the batch's quantity at posting time (read under
 * row lock), so re-posting the same count or counting batches received after the screen opened is safe.
 * Variance at cost posts to Stock loss.
 */
export async function postCount(ctx: Ctx, raw: z.input<typeof countSchema>) {
  authorize(ctx, "adjust");
  const i = countSchema.parse(raw);
  if (new Set(i.lines.map((l) => l.batchId)).size !== i.lines.length) throw new UserError("A batch is listed twice.");
  return db.$transaction(async (tx) => {
    const ids = i.lines.map((l) => l.batchId);
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Batch" WHERE "tenantId" = ${ctx.tenantId} AND "branchId" = ${ctx.branchId} AND id = ANY(${ids}) ORDER BY id FOR UPDATE`;
    if (locked.length !== ids.length) throw new UserError("Some batches aren’t at this branch.");
    const batches = await tx.batch.findMany({ where: { id: { in: ids } }, include: { medicine: { select: { name: true } } } });
    const fy = fiscalYear();
    const no = `SC-${fy}-${pad(await nextSeq(tx, ctx.tenantId, "SC:" + fy))}`;
    let value = 0, changed = 0;
    const out = [];
    for (const l of i.lines) {
      const b = batches.find((x) => x.id === l.batchId)!;
      const system = b.qtyAvailable, d = l.counted - system;
      out.push({ batchId: b.id, name: b.medicine.name, batchNo: b.batchNo, system, counted: l.counted, diff: d, valuePaise: d * big(b.costPaise) });
      if (!d) continue;
      await tx.batch.update({ where: { id: b.id }, data: { qtyAvailable: { increment: d }, version: { increment: 1 } } });
      await tx.stockMovement.create({ data: { tenantId: ctx.tenantId, branchId: ctx.branchId, batchId: b.id, qty: d, type: "count", refType: "stock_count", refId: no, userId: ctx.userId, note: `${no} · counted ${l.counted}, system ${system}` } });
      value += d * big(b.costPaise); changed++;
    }
    await tx.stockCount.create({ data: { tenantId: ctx.tenantId, branchId: ctx.branchId, no, userId: ctx.userId, lines: out, note: i.note || null } });
    if (value) await postVoucher(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, type: "journal", userId: ctx.userId, refType: "stock_count", refId: no, narration: `${no} · stock count variance`,
      lines: value < 0 ? [{ account: ACC.stockLoss, dr: -value }, { account: ACC.inventory, cr: -value }] : [{ account: ACC.inventory, dr: value }, { account: ACC.stockLoss, cr: value }] });
    await writeAudit(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: `Stock count posted ${no}`, entity: "stock_count", entityId: no, detail: `${i.lines.length} counted · ${changed} adjusted · ${inr(value)}` });
    return { no, counted: i.lines.length, changed, value };
  });
}
