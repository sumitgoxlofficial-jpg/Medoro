import "server-only";
import { db, type Tx } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorize, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { nextSeq, pad } from "@/server/sequence";
import { addDays, dateOnly, daysTo, fiscalYear, isoOf, istMidnight, todayISO } from "@/lib/dates";
import { big, inr } from "@/lib/money";
import { postVoucher } from "@/domain/accounting/post";
import { ACC } from "@/domain/accounting/accounts";
import { grnSchema, grnTotals, poSchema, type GrnInput, type PoInput } from "./contracts";

export const ROUND_TOLERANCE = 100; // printed total may differ from the computed one by up to ₹1 (round-off)

/** Posts a GRN inside an existing transaction. Used by the invoice screen and by Inventory's receive form. */
export async function postGrn(tx: Tx, ctx: Ctx, raw: GrnInput) {
  authorize(ctx, "purchase");
  const i = grnSchema.parse(raw);
  const supplier = await tx.supplier.findFirst({ where: { id: i.supplierId, tenantId: ctx.tenantId } });
  if (!supplier) throw new UserError("Supplier not found.");
  const dup = await tx.grn.findFirst({ where: { tenantId: ctx.tenantId, supplierId: supplier.id, supplierInvoiceNo: i.invoiceNo } });
  if (dup) throw new UserError(`Invoice ${i.invoiceNo} from ${supplier.name} was already posted as ${dup.no}.`);
  if (daysTo(i.invoiceDate) > 0) throw new UserError("Invoice date can’t be in the future.");
  const po = i.poId ? await tx.purchaseOrder.findFirst({ where: { id: i.poId, tenantId: ctx.tenantId }, include: { items: true } }) : null;
  if (i.poId && (!po || po.supplierId !== supplier.id)) throw new UserError("That purchase order isn’t from this supplier.");
  if (po && (po.status === "cancelled" || po.status === "received" || po.status === "draft")) throw new UserError(`PO ${po.no} is ${po.status}; it can’t be received against.`);

  const meds = await tx.medicine.findMany({ where: { tenantId: ctx.tenantId, id: { in: i.lines.map((l) => l.medicineId) } } });
  const seen = new Set<string>();
  const lines = i.lines.map((l, n) => {
    const m = meds.find((x) => x.id === l.medicineId);
    if (!m) throw new UserError(`Line ${n + 1}: medicine not found.`);
    if (daysTo(l.expiry) <= 0) throw new UserError(`Line ${n + 1} (${m.name}): batch has already expired.`);
    if (l.rate > l.mrp) throw new UserError(`Line ${n + 1} (${m.name}): rate is above MRP. Check the invoice.`);
    const k = m.id + "|" + l.batchNo;
    if (seen.has(k)) throw new UserError(`Line ${n + 1}: ${m.name} batch ${l.batchNo} appears twice. Combine the lines.`);
    seen.add(k);
    return { ...l, m };
  });
  const t = grnTotals(lines.map((l) => ({ qty: l.qty, rate: l.rate, gstRate: l.m.gstRate })));
  const payable = i.statedTotal ?? Math.round(t.total / 100) * 100;
  const roundOff = payable - t.total;
  if (Math.abs(roundOff) > ROUND_TOLERANCE) throw new UserError(`Totals don’t match: lines add up to ${inr(t.total)}, the invoice says ${inr(payable)}.`);

  const fy = fiscalYear();
  const grnNo = `GRN-${fy}-${pad(await nextSeq(tx, ctx.tenantId, "GRN:" + fy))}`;
  const grn = await tx.grn.create({ data: { tenantId: ctx.tenantId, branchId: ctx.branchId, no: grnNo, supplierId: supplier.id, supplierInvoiceNo: i.invoiceNo, invoiceDate: dateOnly(i.invoiceDate), totalPaise: BigInt(payable), poId: po?.id ?? null, scanDocId: i.scanDocId, approvedBy: ctx.userId } });

  for (const l of lines) {
    const units = l.qty + l.freeQty;
    const unitCost = Math.round((l.rate * l.qty) / units); // free goods lower the effective cost
    const existing = await tx.batch.findFirst({ where: { tenantId: ctx.tenantId, branchId: ctx.branchId, medicineId: l.m.id, batchNo: l.batchNo } });
    let batchId: string;
    if (existing) {
      if (isoOf(existing.expiryDate) !== l.expiry || big(existing.mrpPaise) !== l.mrp) throw new UserError(`${l.m.name} batch ${l.batchNo} already exists with a different expiry or MRP. Check the batch number.`);
      await tx.batch.update({ where: { id: existing.id }, data: { qtyAvailable: { increment: units }, version: { increment: 1 } } });
      batchId = existing.id;
    } else {
      batchId = (await tx.batch.create({ data: { tenantId: ctx.tenantId, branchId: ctx.branchId, medicineId: l.m.id, batchNo: l.batchNo, expiryDate: dateOnly(l.expiry), qtyAvailable: units, costPaise: BigInt(unitCost), mrpPaise: BigInt(l.mrp), supplierId: supplier.id, grnId: grn.id } })).id;
    }
    await tx.grnItem.create({ data: { grnId: grn.id, poItemId: l.poItemId, medicineId: l.m.id, batchId, qty: l.qty, freeQty: l.freeQty, ratePaise: BigInt(l.rate), gstRate: l.m.gstRate } });
    await tx.stockMovement.create({ data: { tenantId: ctx.tenantId, branchId: ctx.branchId, batchId, qty: units, type: "grn", refType: "grn", refId: grn.id, userId: ctx.userId, note: grnNo } });
  }
  const half = Math.floor(t.gst / 2);
  await postVoucher(tx, {
    tenantId: ctx.tenantId, branchId: ctx.branchId, type: "purchase", userId: ctx.userId, refType: "grn", refId: grn.id, date: i.invoiceDate === todayISO() ? new Date() : istMidnight(i.invoiceDate),
    narration: `${supplier.name} · Inv ${i.invoiceNo} · ${grnNo}`,
    lines: [
      { account: ACC.purchases, dr: t.taxable }, { account: ACC.inCgst, dr: half }, { account: ACC.inSgst, dr: t.gst - half },
      roundOff >= 0 ? { account: ACC.roundOff, dr: roundOff } : { account: ACC.roundOff, cr: -roundOff },
      { account: ACC.creditors, cr: payable, partyType: "supplier", partyId: supplier.id },
    ],
  });
  await tx.supplierBill.create({ data: { tenantId: ctx.tenantId, supplierId: supplier.id, ref: i.invoiceNo, date: dateOnly(i.invoiceDate), dueDate: dateOnly(addDays(i.invoiceDate, supplier.creditDays)), amountPaise: BigInt(payable), grnId: grn.id } });
  if (po) await refreshPoStatus(tx, po.id);
  if (i.scanDocId) await tx.scanDocument.updateMany({ where: { id: i.scanDocId, tenantId: ctx.tenantId }, data: { status: "approved" } });
  await writeAudit(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: "GRN posted", entity: "grn", entityId: grn.id, detail: `${grnNo} · ${supplier.name} Inv ${i.invoiceNo} · ${lines.length} line(s) · ${inr(payable)}${po ? " · " + po.no : ""}` });
  return { grnId: grn.id, grnNo, total: payable };
}

export async function postGrnTx(ctx: Ctx, raw: GrnInput) {
  return db.$transaction((tx) => postGrn(tx, ctx, raw), { timeout: 20000 });
}

async function refreshPoStatus(tx: Tx, poId: string) {
  const po = await tx.purchaseOrder.findUniqueOrThrow({ where: { id: poId }, include: { items: true } });
  const got = await tx.grnItem.groupBy({ by: ["poItemId"], where: { poItemId: { in: po.items.map((x) => x.id) } }, _sum: { qty: true } });
  const all = po.items.every((it) => (got.find((g) => g.poItemId === it.id)?._sum.qty ?? 0) >= it.qty);
  const any = got.some((g) => (g._sum.qty ?? 0) > 0);
  await tx.purchaseOrder.update({ where: { id: poId }, data: { status: all ? "received" : any ? "partially_received" : po.status } });
}

// ───────────── Purchase orders ─────────────

export async function listOrders(ctx: Ctx) {
  const pos = await db.purchaseOrder.findMany({ where: { tenantId: ctx.tenantId, branchId: ctx.branchId }, include: { supplier: { select: { name: true } }, items: true }, orderBy: { createdAt: "desc" }, take: 200 });
  const received = await db.grnItem.groupBy({ by: ["poItemId"], where: { poItemId: { in: pos.flatMap((p) => p.items.map((i) => i.id)) } }, _sum: { qty: true } });
  const meds = await db.medicine.findMany({ where: { id: { in: [...new Set(pos.flatMap((p) => p.items.map((i) => i.medicineId)))] } }, select: { id: true, name: true, strength: true } });
  return pos.map((p) => ({
    id: p.id, no: p.no, supplierId: p.supplierId, supplier: p.supplier.name, date: p.createdAt.toISOString(), status: p.status, source: p.source,
    total: p.items.reduce((a, i) => a + i.qty * big(i.ratePaise), 0),
    items: p.items.map((i) => ({ id: i.id, medicineId: i.medicineId, name: meds.find((m) => m.id === i.medicineId)?.name ?? "", qty: i.qty, rate: big(i.ratePaise), received: received.find((r) => r.poItemId === i.id)?._sum.qty ?? 0 })),
  }));
}

export async function createPo(ctx: Ctx, raw: PoInput) {
  authorize(ctx, "purchase");
  const i = poSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const s = await tx.supplier.findFirst({ where: { id: i.supplierId, tenantId: ctx.tenantId } });
    if (!s) throw new UserError("Supplier not found.");
    const meds = await tx.medicine.count({ where: { tenantId: ctx.tenantId, id: { in: i.lines.map((l) => l.medicineId) } } });
    if (meds !== new Set(i.lines.map((l) => l.medicineId)).size) throw new UserError("A line has an unknown medicine.");
    const fy = fiscalYear();
    const no = `PO-${fy}-${pad(await nextSeq(tx, ctx.tenantId, "PO:" + fy))}`;
    const po = await tx.purchaseOrder.create({ data: { tenantId: ctx.tenantId, branchId: ctx.branchId, no, supplierId: s.id, createdBy: ctx.userId, source: i.source, items: { create: i.lines.map((l) => ({ medicineId: l.medicineId, qty: l.qty, ratePaise: BigInt(l.rate) })) } } });
    await writeAudit(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: "Draft PO created", entity: "purchase_order", entityId: po.id, detail: `${no} · ${s.name} · ${i.lines.length} item(s) · ${inr(i.lines.reduce((a, l) => a + l.qty * l.rate, 0))}${i.note ? " · " + i.note : ""}` });
    return { id: po.id, no };
  });
}

export async function setPoStatus(ctx: Ctx, id: string, action: "place" | "cancel") {
  authorize(ctx, "purchase");
  return db.$transaction(async (tx) => {
    const po = await tx.purchaseOrder.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!po) throw new UserError("Purchase order not found.");
    if (action === "place" && po.status !== "draft") throw new UserError("Only drafts can be placed.");
    if (action === "cancel" && !["draft", "ordered"].includes(po.status)) throw new UserError("Orders with receipts can’t be cancelled.");
    await tx.purchaseOrder.update({ where: { id }, data: { status: action === "place" ? "ordered" : "cancelled" } });
    await writeAudit(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: action === "place" ? "PO placed" : "PO cancelled", entity: "purchase_order", entityId: id, detail: po.no });
  });
}

/** Catalogue + last purchase rate per medicine, for PO and GRN forms. */
export async function purchaseCatalogue(ctx: Ctx) {
  const meds = await db.medicine.findMany({ where: { tenantId: ctx.tenantId, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, strength: true, pack: true, gstRate: true, mrpPaise: true } });
  const last = await db.$queryRaw<{ medicineId: string; rate: bigint }[]>`
    SELECT DISTINCT ON (gi."medicineId") gi."medicineId", gi."ratePaise" AS rate FROM "GrnItem" gi JOIN "Grn" g ON g.id = gi."grnId"
    WHERE g."tenantId" = ${ctx.tenantId} ORDER BY gi."medicineId", g."approvedAt" DESC`;
  return meds.map((m) => ({ id: m.id, label: `${m.name} ${m.strength}`, pack: m.pack, gstRate: m.gstRate, mrp: big(m.mrpPaise), lastRate: Number(last.find((l) => l.medicineId === m.id)?.rate ?? 0) }));
}

export async function recentGrns(ctx: Ctx) {
  const g = await db.grn.findMany({ where: { tenantId: ctx.tenantId, branchId: ctx.branchId }, orderBy: { approvedAt: "desc" }, take: 20, include: { items: true } });
  const sups = await db.supplier.findMany({ where: { id: { in: g.map((x) => x.supplierId) } }, select: { id: true, name: true } });
  return g.map((x) => ({ id: x.id, no: x.no, supplier: sups.find((s) => s.id === x.supplierId)?.name ?? "", invoiceNo: x.supplierInvoiceNo, date: x.approvedAt.toISOString(), lines: x.items.length, total: big(x.totalPaise) }));
}

