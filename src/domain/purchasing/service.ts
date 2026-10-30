import "server-only";
import { db, type DbOrTx, type Tx } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorize, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { nextSeq, pad } from "@/server/sequence";
import { addDays, dateOnly, daysTo, fiscalYear, isoOf, istMidnight, todayISO } from "@/lib/dates";
import { big, inr } from "@/lib/money";
import { postVoucher } from "@/domain/accounting/post";
import { ACC } from "@/domain/accounting/accounts";
import { isInterState, stateOf } from "@/domain/accounting/gst";
import { grnSchema, grnTotals, LOW_CONFIDENCE, poSchema, type GrnInput, type PoInput } from "./contracts";
import { priceLine, rulesOf, schemeFree } from "./pricing";
import { nameKey } from "./ebill";

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
  if (i.poId) await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"po:" + i.poId}))`;
  const po = i.poId ? await tx.purchaseOrder.findFirst({ where: { id: i.poId, tenantId: ctx.tenantId }, include: { items: true } }) : null;
  if (i.poId && (!po || po.supplierId !== supplier.id)) throw new UserError("That purchase order isn’t from this supplier.");
  if (po && (po.status === "cancelled" || po.status === "received" || po.status === "draft" || po.status === "closed")) throw new UserError(`PO ${po.no} is ${po.status === "closed" ? "closed short" : po.status}; it can’t be received against.`);
  if (po && po.branchId !== ctx.branchId) throw new UserError(`PO ${po.no} belongs to another branch. Switch to that branch to receive it.`);
  const poRef = i.lines.filter((l) => l.poItemId);
  if (poRef.length && !po) throw new UserError("Choose the purchase order these lines belong to.");
  const prior = po ? await tx.grnItem.groupBy({ by: ["poItemId"], where: { poItemId: { in: po.items.map((x) => x.id) } }, _sum: { qty: true } }) : [];
  const onGrn = new Map<string, number>();
  for (const l of poRef) {
    const it = po!.items.find((x) => x.id === l.poItemId);
    if (!it || it.medicineId !== l.medicineId) throw new UserError(`Line ${i.lines.indexOf(l) + 1}: it doesn’t match an item on PO ${po!.no}.`);
    onGrn.set(it.id, (onGrn.get(it.id) ?? 0) + l.qty);
    const already = prior.find((g) => g.poItemId === it.id)?._sum.qty ?? 0;
    if (already + onGrn.get(it.id)! > it.qty) throw new UserError(`Line ${i.lines.indexOf(l) + 1}: PO ${po!.no} ordered ${it.qty}, ${already} already received. Enter extra units as free quantity or as a line without the PO item.`);
  }

  const meds = await tx.medicine.findMany({ where: { tenantId: ctx.tenantId, id: { in: i.lines.map((l) => l.medicineId) } } });
  const seen = new Set<string>();
  const lines = i.lines.map((l, n) => {
    const m = meds.find((x) => x.id === l.medicineId);
    if (!m) throw new UserError(`Line ${n + 1}: medicine not found.`);
    if (daysTo(l.expiry) <= 0) throw new UserError(`Line ${n + 1} (${m.name}): batch has already expired.`);
    if (l.rate > l.mrp) throw new UserError(`Line ${n + 1} (${m.name}): rate is above MRP. Check the invoice.`);
    if (l.pts != null && l.pts > l.mrp) throw new UserError(`Line ${n + 1} (${m.name}): PTS is above MRP. Check the invoice.`);
    const k = m.id + "|" + l.batchNo;
    if (seen.has(k)) throw new UserError(`Line ${n + 1}: ${m.name} batch ${l.batchNo} appears twice. Combine the lines.`);
    seen.add(k);
    return { ...l, freeQty: l.freeQty || schemeFree(l.qty, l.scheme), m };
  });
  const rules = rulesOf((await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { settings: true } })).settings);
  const t = grnTotals(lines.map((l) => ({ qty: l.qty, freeQty: l.freeQty, rate: l.rate, gstRate: l.m.gstRate, schemePct: l.schemePct, tradePct: l.tradePct, cashPct: l.cashPct })), rules);
  const payable = i.statedTotal ?? Math.round(t.total / 100) * 100;
  const roundOff = payable - t.total;
  if (Math.abs(roundOff) > ROUND_TOLERANCE) throw new UserError(`Totals don’t match: lines add up to ${inr(t.total)}, the invoice says ${inr(payable)}.`);
  if (i.scanDocId) {
    const doc = await tx.scanDocument.findFirst({ where: { id: i.scanDocId, tenantId: ctx.tenantId, status: "review" } });
    if (!doc) throw new UserError("That uploaded invoice was already posted or discarded. Upload it again.");
    if (i.statedTotal == null) throw new UserError("Enter the total printed on the invoice. Uploaded invoices are approved only when the lines add up to it.");
    const extracted = (doc.extracted as OcrExtract | null)?.lines ?? [];
    i.lines.forEach((l, n) => {
      if (l.ocrIndex == null) return;
      const x = extracted[l.ocrIndex];
      if (!x) throw new UserError(`Line ${n + 1} doesn’t match a line read from the uploaded invoice.`);
      if (!(x.confidence >= LOW_CONFIDENCE) && !l.verified) throw new UserError(`Line ${n + 1} (“${x.text.slice(0, 40)}”) was read with low confidence. Check it against the invoice and tick “Verified”.`);
    });
  }
  const igst = await supplierIsInterState(tx, ctx.tenantId, ctx.branchId, supplier);

  const fy = fiscalYear();
  const grnNo = `GRN-${fy}-${pad(await nextSeq(tx, ctx.tenantId, "GRN:" + fy))}`;
  const grn = await tx.grn.create({ data: { tenantId: ctx.tenantId, branchId: ctx.branchId, no: grnNo, supplierId: supplier.id, supplierInvoiceNo: i.invoiceNo, invoiceDate: dateOnly(i.invoiceDate), totalPaise: BigInt(payable), poId: po?.id ?? null, scanDocId: i.scanDocId, igst, itc: rules.itc, gstBase: rules.gstBase, approvedBy: ctx.userId } });

  for (const [n, l] of lines.entries()) {
    // Priced per pack (paid + free packs); stock is kept in stock units (loose units for medicines sold loose).
    const p = t.lines[n], units = p.units * l.m.packSize;
    const found = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Batch" WHERE "tenantId" = ${ctx.tenantId} AND "branchId" = ${ctx.branchId} AND "medicineId" = ${l.m.id} AND "batchNo" = ${l.batchNo} FOR UPDATE`;
    const existing = found.length ? await tx.batch.findUniqueOrThrow({ where: { id: found[0].id } }) : null;
    let batchId: string;
    if (existing) {
      if (isoOf(existing.expiryDate) !== l.expiry || big(existing.mrpPaise) !== l.mrp) throw new UserError(`${l.m.name} batch ${l.batchNo} already exists with a different expiry or MRP. Check the batch number.`);
      // One row per batch number (unique key), so a top-up blends landed cost by weighted average and the batch's
      // supplier becomes the latest one; each receipt's own supplier and rate stay on its GRN.
      const onHand = Math.max(existing.qtyAvailable, 0);
      const cost = onHand ? Math.round((onHand * big(existing.costPaise) + p.cost * l.m.packSize) / (onHand + units)) : p.landed; // per pack, weighted by stock units
      await tx.batch.update({ where: { id: existing.id }, data: { qtyAvailable: { increment: units }, costPaise: BigInt(cost), supplierId: supplier.id, grnId: grn.id, version: { increment: 1 } } });
      batchId = existing.id;
    } else {
      batchId = (await tx.batch.create({ data: { tenantId: ctx.tenantId, branchId: ctx.branchId, medicineId: l.m.id, batchNo: l.batchNo, expiryDate: dateOnly(l.expiry), qtyAvailable: units, costPaise: BigInt(p.landed), mrpPaise: BigInt(l.mrp), supplierId: supplier.id, grnId: grn.id } })).id;
    }
    await tx.grnItem.create({ data: { grnId: grn.id, poItemId: l.poItemId, medicineId: l.m.id, batchId, qty: l.qty, freeQty: l.freeQty, ratePaise: BigInt(l.rate), gstRate: l.m.gstRate,
      ptsPaise: l.pts == null ? null : BigInt(l.pts), mrpPaise: BigInt(l.mrp), scheme: l.scheme || null, schemePct: l.schemePct, tradePct: l.tradePct, cashPct: l.cashPct,
      discPaise: BigInt(p.disc), basePaise: BigInt(p.taxable), gstPaise: BigInt(p.gst), costPaise: BigInt(p.landed) } });
    await tx.stockMovement.create({ data: { tenantId: ctx.tenantId, branchId: ctx.branchId, batchId, qty: units, type: "grn", refType: "grn", refId: grn.id, userId: ctx.userId, note: grnNo } });
    for (const code of [l.supplierCode, l.sourceName && nameKey(l.sourceName)]) {
      if (code) await tx.supplierItemMap.upsert({ where: { tenantId_supplierId_code: { tenantId: ctx.tenantId, supplierId: supplier.id, code } }, create: { tenantId: ctx.tenantId, supplierId: supplier.id, code, medicineId: l.m.id }, update: { medicineId: l.m.id } });
    }
  }
  const half = Math.floor(t.gst / 2);
  await postVoucher(tx, {
    tenantId: ctx.tenantId, branchId: ctx.branchId, type: "purchase", userId: ctx.userId, refType: "grn", refId: grn.id, date: i.invoiceDate === todayISO() ? new Date() : istMidnight(i.invoiceDate),
    narration: `${supplier.name} · Inv ${i.invoiceNo} · ${grnNo}${igst ? " · IGST" : ""}${rules.itc ? "" : " · GST in cost"}`,
    lines: [
      ...(rules.itc ? [{ account: ACC.purchases, dr: t.net }, ...(igst ? [{ account: ACC.inIgst, dr: t.gst }] : [{ account: ACC.inCgst, dr: half }, { account: ACC.inSgst, dr: t.gst - half }])] : [{ account: ACC.purchases, dr: t.net + t.gst }]),
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

/** Supplier invoice approval from the Purchases screen: the printed total is required and must match the lines (± ₹1). */
export async function approveSupplierInvoice(ctx: Ctx, raw: GrnInput) {
  if (raw.statedTotal == null || String(raw.statedTotal).trim() === "") throw new UserError("Enter the total printed on the supplier invoice. It’s approved only when the lines add up to it.");
  return postGrnTx(ctx, raw);
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
    id: p.id, no: p.no, supplierId: p.supplierId, supplier: p.supplier.name, date: p.createdAt.toISOString(), status: p.status, source: p.source, closedReason: p.closedReason,
    total: p.items.reduce((a, i) => a + poLineNet(i), 0),
    items: p.items.map((i) => ({
      id: i.id, medicineId: i.medicineId, name: meds.find((m) => m.id === i.medicineId)?.name ?? "", qty: i.qty, rate: big(i.ratePaise), received: received.find((r) => r.poItemId === i.id)?._sum.qty ?? 0,
      freeQty: i.freeQty, pts: i.ptsPaise == null ? null : big(i.ptsPaise), mrp: i.mrpPaise == null ? null : big(i.mrpPaise), scheme: i.scheme ?? "", schemePct: Number(i.schemePct), tradePct: Number(i.tradePct), cashPct: Number(i.cashPct), net: poLineNet(i),
    })),
  }));
}

/** PO line value after its scheme, trade and cash discounts, excluding GST. */
const poLineNet = (i: { qty: number; ratePaise: bigint; schemePct: unknown; tradePct: unknown; cashPct: unknown }) =>
  priceLine({ qty: i.qty, rate: big(i.ratePaise), gstRate: 0, schemePct: Number(i.schemePct), tradePct: Number(i.tradePct), cashPct: Number(i.cashPct) }).net;

export async function createPo(ctx: Ctx, raw: PoInput) {
  return db.$transaction((tx) => createPoIn(tx, ctx, raw));
}

/** Draft PO for `branchId` (default: the current branch; must be one the user can access). */
export async function createPoIn(tx: Tx, ctx: Ctx, raw: PoInput, branchId = ctx.branchId) {
  authorize(ctx, "purchase");
  const i = poSchema.parse(raw);
  if (!ctx.branches.some((b) => b.id === branchId)) throw new UserError("You don’t have access to that branch.");
  const s = await tx.supplier.findFirst({ where: { id: i.supplierId, tenantId: ctx.tenantId } });
  if (!s) throw new UserError("Supplier not found.");
  const meds = await tx.medicine.count({ where: { tenantId: ctx.tenantId, id: { in: i.lines.map((l) => l.medicineId) } } });
  if (meds !== new Set(i.lines.map((l) => l.medicineId)).size) throw new UserError("A line has an unknown medicine.");
  const fy = fiscalYear();
  const no = `PO-${fy}-${pad(await nextSeq(tx, ctx.tenantId, "PO:" + fy))}`;
  const po = await tx.purchaseOrder.create({ data: { tenantId: ctx.tenantId, branchId, no, supplierId: s.id, createdBy: ctx.userId, source: i.source, items: { create: i.lines.map((l) => ({ medicineId: l.medicineId, qty: l.qty, ratePaise: BigInt(l.rate), freeQty: l.freeQty || schemeFree(l.qty, l.scheme), ptsPaise: l.pts == null ? null : BigInt(l.pts), mrpPaise: l.mrp == null ? null : BigInt(l.mrp), scheme: l.scheme || null, schemePct: l.schemePct, tradePct: l.tradePct, cashPct: l.cashPct })) } } });
  await writeAudit(tx, { tenantId: ctx.tenantId, branchId, userId: ctx.userId, userName: ctx.userName, action: "Draft PO created", entity: "purchase_order", entityId: po.id, detail: `${no} · ${s.name} · ${i.lines.length} item(s) · ${inr(i.lines.reduce((a, l) => a + priceLine({ qty: l.qty, rate: l.rate, gstRate: 0, schemePct: l.schemePct, tradePct: l.tradePct, cashPct: l.cashPct }).net, 0))}${i.note ? " · " + i.note : ""}` });
  return { id: po.id, no };
}

export async function setPoStatus(ctx: Ctx, id: string, action: "place" | "cancel" | "close", reason = "") {
  authorize(ctx, "purchase");
  if (action !== "place" && reason.trim().length < 3) throw new UserError(action === "cancel" ? "Enter why the order is cancelled." : "Enter why the order is closed short.");
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"po:" + id}))`;
    const po = await tx.purchaseOrder.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { items: true } });
    if (!po) throw new UserError("Purchase order not found.");
    if (action === "place" && po.status !== "draft") throw new UserError("Only drafts can be placed.");
    if (action === "cancel" && !["draft", "ordered"].includes(po.status)) throw new UserError(po.status === "partially_received" ? "Part of this order was received, so it can’t be cancelled. Close it short instead." : `${po.no} is ${po.status === "closed" ? "closed short" : po.status} and can’t be cancelled.`);
    if (action === "close" && po.status !== "partially_received") throw new UserError(po.status === "ordered" ? "Nothing was received on this order. Cancel it instead." : "Only partly received orders can be closed short.");
    const got = action === "close" ? await tx.grnItem.groupBy({ by: ["poItemId"], where: { poItemId: { in: po.items.map((x) => x.id) } }, _sum: { qty: true } }) : [];
    const short = po.items.reduce((a, it) => a + Math.max(0, it.qty - (got.find((g) => g.poItemId === it.id)?._sum.qty ?? 0)), 0);
    await tx.purchaseOrder.update({
      where: { id },
      data: action === "place" ? { status: "ordered", placedAt: new Date() } : { status: action === "cancel" ? "cancelled" : "closed", closedAt: new Date(), closedBy: ctx.userId, closedReason: reason.trim() },
    });
    await writeAudit(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: action === "place" ? "PO placed" : action === "cancel" ? "PO cancelled" : "PO closed short", entity: "purchase_order", entityId: id,
      detail: `${po.no}${action === "close" ? ` · ${short} unit(s) not delivered` : ""}${reason.trim() ? " · " + reason.trim() : ""}` });
  });
}

/** Branch state (branch GSTIN, else the pharmacy's) against the supplier's state. */
export async function supplierIsInterState(tx: DbOrTx, tenantId: string, branchId: string, s: { stateCode: string | null; gstin: string | null }) {
  const br = await tx.branch.findFirstOrThrow({ where: { id: branchId, tenantId }, include: { tenant: { select: { gstin: true } } } });
  return isInterState(stateOf(null, br.gstin ?? br.tenant.gstin), stateOf(s.stateCode, s.gstin));
}

/**
 * Delivery accuracy per supplier from placed orders and their GRNs: fill = units received (capped at the
 * ordered quantity) / units ordered; on time = units received within the lead time (+1 day) of placing the
 * order. Orders still inside their lead time are not counted yet. Null when there's no history.
 */
export async function supplierPerformance(tx: DbOrTx, tenantId: string) {
  const [pos, sups] = await Promise.all([
    tx.purchaseOrder.findMany({ where: { tenantId, status: { in: ["ordered", "partially_received", "received", "closed"] } }, include: { items: true } }),
    tx.supplier.findMany({ where: { tenantId }, select: { id: true, leadDays: true } }),
  ]);
  const grnItems = pos.length ? await tx.grnItem.findMany({ where: { poItemId: { in: pos.flatMap((p) => p.items.map((i) => i.id)) } }, include: { grn: { select: { approvedAt: true } } } }) : [];
  const acc = new Map<string, { ordered: number; filled: number; onTime: number; orders: number }>();
  const now = Date.now();
  for (const po of pos) {
    const lead = Math.ceil(Number(sups.find((s) => s.id === po.supplierId)?.leadDays ?? 1)) + 1;
    const placed = (po.placedAt ?? po.createdAt).getTime(), due = placed + lead * 86400_000;
    if (po.status === "ordered" && now <= due) continue;
    const a = acc.get(po.supplierId) ?? { ordered: 0, filled: 0, onTime: 0, orders: 0 };
    a.orders++;
    for (const it of po.items) {
      const got = grnItems.filter((g) => g.poItemId === it.id).sort((x, y) => +x.grn.approvedAt - +y.grn.approvedAt);
      let left = it.qty, early = 0;
      for (const g of got) { const q = Math.min(left, g.qty); left -= q; if (g.grn.approvedAt.getTime() <= due) early += q; }
      a.ordered += it.qty; a.filled += it.qty - left; a.onTime += early;
    }
    acc.set(po.supplierId, a);
  }
  return new Map([...acc].map(([id, a]) => [id, { fillPct: a.ordered ? Math.round((a.filled / a.ordered) * 100) : 100, onTimePct: a.ordered ? Math.round((a.onTime / a.ordered) * 100) : 100, orders: a.orders }]));
}

// ───────────── Uploaded supplier invoices ─────────────

export async function pendingScans(ctx: Ctx) {
  const docs = await db.scanDocument.findMany({ where: { tenantId: ctx.tenantId, status: "review" }, orderBy: { createdAt: "desc" }, take: 50 });
  const users = await db.user.findMany({ where: { tenantId: ctx.tenantId, id: { in: [...new Set(docs.map((d) => d.createdBy))] } }, select: { id: true, name: true } });
  return docs.map((d) => ({ id: d.id, name: d.fileName, mime: d.mime ?? "", at: d.createdAt.toISOString(), by: users.find((u) => u.id === d.createdBy)?.name ?? "", extracted: d.extracted as OcrExtract | null }));
}
export type OcrExtract = { invoiceNo?: string; invoiceDate?: string; total?: number; lines?: { text: string; name?: string; batch?: string; expiry?: string; qty?: number; freeQty?: number; rate?: number; mrp?: number; confidence: number; medicineId: string | null }[] };

/** Discards an uploaded invoice that won't be posted. The file is kept for audit; it leaves the review queue. */
export async function discardScan(ctx: Ctx, id: string, reason: string) {
  authorize(ctx, "purchase");
  if (reason.trim().length < 3) throw new UserError("Enter why the invoice is discarded.");
  return db.$transaction(async (tx) => {
    const d = await tx.scanDocument.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!d) throw new UserError("Document not found.");
    if (!(await tx.scanDocument.updateMany({ where: { id, status: "review" }, data: { status: "rejected" } })).count) throw new UserError(`This invoice is already ${d.status}.`);
    await writeAudit(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: "Uploaded invoice discarded", entity: "scan_document", entityId: id, detail: `${d.fileName} · ${reason.trim()}` });
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

