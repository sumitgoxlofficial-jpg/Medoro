import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import type { Ctx } from "@/server/context";
import { nextSeq, pad } from "@/server/sequence";
import { zId } from "@/lib/id";
import { fiscalYear, isoOf, todayISO } from "@/lib/dates";
import { receiveFromCustomer } from "@/domain/parties/service";
import { distAuthorize, distAuthorizeAny, distCan } from "./context";
import { audit, lockKey, num } from "./common";
import { assertMove } from "./rules/orderflow";

// ───────────── Dispatch (route / van trips) ─────────────

export const dispatchSchema = z.object({ vehicleNo: z.string().trim().toUpperCase().max(20).default(""), driverName: z.string().trim().max(60).default(""), deliveryUser: z.string().default(""), route: z.string().trim().max(80).default(""), invoiceIds: z.array(zId()).min(1, "Choose the invoices going out.") });

export async function createDispatch(ctx: Ctx, raw: z.input<typeof dispatchSchema>) {
  distAuthorize(ctx, "dispatch");
  const i = dispatchSchema.parse(raw);
  if (i.deliveryUser && !(await db.user.findFirst({ where: { id: i.deliveryUser, tenantId: ctx.tenantId, active: true } }))) throw new UserError("Delivery person not found.");
  return db.$transaction(async (tx) => {
    const dels = await tx.distDelivery.findMany({ where: { tenantId: ctx.tenantId, invoiceId: { in: i.invoiceIds } } });
    if (dels.length !== i.invoiceIds.length) throw new UserError("An invoice was not found.");
    const busy = dels.find((d) => d.dispatchId || d.status !== "pending");
    if (busy) throw new UserError("An invoice is already on another dispatch or delivered.");
    const invs = await tx.distInvoice.findMany({ where: { id: { in: i.invoiceIds } }, select: { id: true, branchId: true, no: true } });
    if (invs.some((x) => x.branchId !== ctx.branchId)) throw new UserError("Dispatch invoices from the godown you are in.");
    if (await tx.distInvoiceCancel.count({ where: { invoiceId: { in: i.invoiceIds } } })) throw new UserError("A cancelled invoice can’t be dispatched.");
    const fy = fiscalYear();
    const no = `DSP-${fy}-${pad(await nextSeq(tx, ctx.tenantId, "DSP:" + fy), 5)}`;
    const d = await tx.distDispatch.create({ data: { tenantId: ctx.tenantId, branchId: ctx.branchId, no, vehicleNo: i.vehicleNo || null, driverName: i.driverName || null, deliveryUser: i.deliveryUser || null, route: i.route || null, createdBy: ctx.userId } });
    await tx.distDelivery.updateMany({ where: { id: { in: dels.map((x) => x.id) } }, data: { dispatchId: d.id, updatedBy: ctx.userId } });
    await audit(tx, ctx, "Dispatch planned", "dist_dispatch", d.id, `${no} · ${invs.map((x) => x.no).join(", ")}`.slice(0, 400));
    return { dispatchId: d.id, no };
  });
}

/** The van leaves: every delivery on it is out, and their orders are dispatched. */
export async function startDispatch(ctx: Ctx, id: string) {
  distAuthorize(ctx, "dispatch");
  return db.$transaction(async (tx) => {
    await lockKey(tx, "dist_dispatch:" + id);
    const d = await tx.distDispatch.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!d) throw new UserError("Dispatch not found.");
    if (d.status !== "planned") throw new UserError("This dispatch already left.");
    const dels = await tx.distDelivery.findMany({ where: { dispatchId: id } });
    await tx.distDelivery.updateMany({ where: { dispatchId: id, status: "pending" }, data: { status: "out", updatedBy: ctx.userId } });
    const invs = await tx.distInvoice.findMany({ where: { id: { in: dels.map((x) => x.invoiceId) } }, select: { orderId: true } });
    for (const o of invs) if (o.orderId) {
      const ord = await tx.distOrder.findUniqueOrThrow({ where: { id: o.orderId } });
      if (ord.status === "invoiced") await tx.distOrder.update({ where: { id: ord.id }, data: { status: "dispatched", version: { increment: 1 } } });
    }
    await tx.distDispatch.update({ where: { id }, data: { status: "out", dispatchedAt: new Date() } });
    await audit(tx, ctx, "Dispatch left", "dist_dispatch", id, `${d.no} · ${dels.length} invoice(s)`);
  });
}

export const deliverSchema = z.object({
  outcome: z.enum(["delivered", "failed"]), receiverName: z.string().trim().max(60).default(""), note: z.string().trim().max(200).default(""),
  collected: z.union([z.string(), z.number()]).default(0).transform((v) => Math.round((Number(String(v).replace(/,/g, "")) || 0) * 100)).refine((p) => p >= 0, "Amount can’t be negative."),
  mode: z.enum(["Cash", "UPI", "Cheque"]).default("Cash"), ref: z.string().trim().max(60).default(""), chequeNo: z.string().trim().max(12).default(""), bank: z.string().trim().max(60).default(""), chequeDate: z.string().default(""),
});

/**
 * Proof of delivery. A delivered invoice needs the receiver's name; money collected at the door posts a receipt
 * through the shared receipts service (cash, UPI or a cheque that clears through Cheques in hand). A failed delivery
 * returns the invoice to the dispatch desk.
 */
export async function recordDelivery(ctx: Ctx, deliveryId: string, raw: z.input<typeof deliverSchema>) {
  distAuthorizeAny(ctx, "delivery", "dispatch");
  const i = deliverSchema.parse(raw);
  if (i.outcome === "delivered" && i.receiverName.length < 2) throw new UserError("Enter who received the goods.");
  if (i.outcome === "failed" && i.note.length < 3) throw new UserError("Enter why it couldn’t be delivered.");
  const del = await db.distDelivery.findFirst({ where: { id: deliveryId, tenantId: ctx.tenantId } });
  if (!del) throw new UserError("Delivery not found.");
  if (del.status === "delivered") throw new UserError("Already delivered.");
  if (del.status !== "out" && del.status !== "pending") throw new UserError("This delivery isn’t out.");
  if (!distCan(ctx, "dispatch")) {
    const d = del.dispatchId ? await db.distDispatch.findUnique({ where: { id: del.dispatchId } }) : null;
    if (d?.deliveryUser !== ctx.userId) throw new UserError("This delivery isn’t assigned to you.");
  }
  const inv = await db.distInvoice.findUniqueOrThrow({ where: { id: del.invoiceId } });
  let receiptNo: string | null = null;
  if (i.outcome === "delivered" && i.collected > 0) {
    // Receipts need the payments permission; delivery staff collect on the distributor's behalf.
    const collector = { ...ctx, perms: [...ctx.perms, "payments"] };
    receiptNo = await receiveFromCustomer(collector, { partyId: inv.customerId, amount: (i.collected / 100).toFixed(2), method: i.mode, ref: i.ref || `${inv.no} delivery`, chequeNo: i.chequeNo, bank: i.bank, chequeDate: i.chequeDate });
  }
  return db.$transaction(async (tx) => {
    await lockKey(tx, "dist_delivery:" + deliveryId);
    const cur = await tx.distDelivery.findUniqueOrThrow({ where: { id: deliveryId } });
    if (cur.status === "delivered") throw new UserError("Already delivered.");
    if (cur.status !== "out" && cur.status !== "pending") throw new UserError("This delivery isn’t out.");
    await tx.distDelivery.update({ where: { id: deliveryId }, data: i.outcome === "delivered"
      ? { status: "delivered", receiverName: i.receiverName, podNote: i.note || null, collectedPaise: BigInt(i.collected), collectMode: i.collected ? i.mode : null, receiptNo, deliveredAt: new Date(), updatedBy: ctx.userId }
      : { status: "pending", dispatchId: null, failReason: i.note, updatedBy: ctx.userId } });
    if (inv.orderId) {
      const o = await tx.distOrder.findUniqueOrThrow({ where: { id: inv.orderId } });
      if (i.outcome === "delivered" && (o.status === "dispatched" || o.status === "invoiced")) { assertMove(o.status, "delivered"); await tx.distOrder.update({ where: { id: o.id }, data: { status: "delivered", version: { increment: 1 } } }); }
      if (i.outcome === "failed" && o.status === "dispatched") await tx.distOrder.update({ where: { id: o.id }, data: { status: "invoiced", version: { increment: 1 } } });
    }
    if (receiptNo) await tx.distCollection.create({ data: { tenantId: ctx.tenantId, customerId: inv.customerId, voucherNo: receiptNo, amountPaise: BigInt(i.collected), mode: i.mode, ref: i.ref || null, deliveryId, byUser: ctx.userId } });
    await audit(tx, ctx, i.outcome === "delivered" ? "Delivered" : "Delivery failed", "dist_delivery", deliveryId, `${inv.no}${i.outcome === "delivered" ? ` · received by ${i.receiverName}` : ` · ${i.note}`}${receiptNo ? ` · collected ₹${(i.collected / 100).toFixed(2)} ${i.mode} (${receiptNo})` : ""}`);
    if (cur.dispatchId) {
      const left = await tx.distDelivery.count({ where: { dispatchId: cur.dispatchId, status: { in: ["out", "pending"] }, NOT: { id: deliveryId } } });
      if (!left) await tx.distDispatch.update({ where: { id: cur.dispatchId }, data: { status: "closed", closedAt: new Date() } });
    }
    return { receiptNo };
  });
}

export async function dispatchBoard(ctx: Ctx) {
  const [pending, trips] = await Promise.all([
    db.distDelivery.findMany({ where: { tenantId: ctx.tenantId, status: "pending", dispatchId: null }, orderBy: { updatedAt: "asc" }, take: 300 }),
    db.distDispatch.findMany({ where: { tenantId: ctx.tenantId, branchId: { in: ctx.branches.map((b) => b.id) }, OR: [{ status: { in: ["planned", "out"] } }, { closedAt: { gte: new Date(Date.now() - 3 * 86400000) } }] }, orderBy: { createdAt: "desc" } }),
  ]);
  const tripDels = await db.distDelivery.findMany({ where: { dispatchId: { in: trips.map((t) => t.id) } } });
  const invIds = [...pending, ...tripDels].map((d) => d.invoiceId);
  const invs = await db.distInvoice.findMany({ where: { id: { in: invIds }, branchId: { in: ctx.branches.map((b) => b.id) } } });
  const cancelled = new Set((await db.distInvoiceCancel.findMany({ where: { invoiceId: { in: invIds } } })).map((c) => c.invoiceId));
  const custs = await db.customer.findMany({ where: { id: { in: invs.map((x) => x.customerId) } }, select: { id: true, name: true, address: true, pincode: true, phone: true } });
  const users = await db.user.findMany({ where: { tenantId: ctx.tenantId, active: true }, include: { role: true } });
  const row = (d: (typeof tripDels)[number]) => {
    const inv = invs.find((x) => x.id === d.invoiceId);
    if (!inv) return null;
    const c = custs.find((x) => x.id === inv.customerId);
    return { deliveryId: d.id, invoiceId: inv.id, no: inv.no, date: isoOf(inv.date), total: num(inv.totalPaise), customer: c?.name ?? "—", address: [c?.address, c?.pincode].filter(Boolean).join(" "), phone: c?.phone ?? null, status: d.status, receiverName: d.receiverName, collected: num(d.collectedPaise), failReason: d.failReason };
  };
  return {
    pending: pending.filter((d) => !cancelled.has(d.invoiceId)).map(row).filter((x) => x !== null),
    trips: trips.map((t) => ({ ...t, deliveries: tripDels.filter((d) => d.dispatchId === t.id).map(row).filter((x) => x !== null), deliveryName: users.find((u) => u.id === t.deliveryUser)?.name ?? null })),
    deliveryStaff: users.filter((u) => u.role.permissions.includes("delivery")).map((u) => ({ id: u.id, name: u.name })),
  };
}

/** The signed-in delivery person's run for today. */
export async function myDeliveries(ctx: Ctx) {
  distAuthorizeAny(ctx, "delivery", "dispatch");
  // Open trips, plus trips closed in the last 12 hours so the run's results stay visible after the last drop.
  const trips = await db.distDispatch.findMany({ where: { tenantId: ctx.tenantId, OR: [{ status: { in: ["planned", "out"] } }, { closedAt: { gte: new Date(Date.now() - 12 * 3600000) } }], ...(distCan(ctx, "dispatch") ? {} : { deliveryUser: ctx.userId }) }, orderBy: { createdAt: "asc" } });
  const board = await dispatchBoard(ctx);
  return board.trips.filter((t) => trips.some((x) => x.id === t.id));
}

// ───────────── Salesman / office collections ─────────────

export const collectSchema = z.object({ customerId: zId("Choose the chemist."), amount: z.union([z.string(), z.number()]), method: z.enum(["Cash", "UPI", "Bank transfer (NEFT)", "Cheque"]), ref: z.string().trim().max(60).default(""), chequeNo: z.string().default(""), bank: z.string().default(""), chequeDate: z.string().default("") });

/** Records a payment from a chemist (office or salesman in the field) as a receipt voucher and a collection row. */
export async function collectPayment(ctx: Ctx, raw: z.input<typeof collectSchema>) {
  distAuthorize(ctx, "payments");
  const i = collectSchema.parse(raw);
  const sm = await db.distSalesman.findFirst({ where: { tenantId: ctx.tenantId, userId: ctx.userId, active: true } });
  const chem = await db.distChemist.findFirst({ where: { tenantId: ctx.tenantId, customerId: i.customerId } });
  if (!chem) throw new UserError("Chemist not found.");
  if (sm && !distCan(ctx, "approve") && chem.salesmanId !== sm.id) throw new UserError("This chemist isn’t assigned to you.");
  const voucherNo = await receiveFromCustomer(ctx, { partyId: i.customerId, amount: i.amount, method: i.method, ref: i.ref, chequeNo: i.chequeNo, bank: i.bank, chequeDate: i.chequeDate });
  const amt = Math.round(Number(String(i.amount).replace(/,/g, "")) * 100);
  await db.$transaction(async (tx) => {
    await tx.distCollection.create({ data: { tenantId: ctx.tenantId, customerId: i.customerId, voucherNo, amountPaise: BigInt(amt), mode: i.method, ref: i.ref || null, salesmanId: sm?.id ?? null, byUser: ctx.userId } });
    await audit(tx, ctx, "Payment collected", "dist_collection", i.customerId, `${voucherNo} · ₹${(amt / 100).toFixed(2)} · ${i.method}${sm ? " · by " + sm.name : ""}`);
  });
  return voucherNo;
}

export async function collectionsOn(ctx: Ctx, day = todayISO()) {
  const from = new Date(day + "T00:00:00+05:30"), to = new Date(from.getTime() + 86400000);
  const rows = await db.distCollection.findMany({ where: { tenantId: ctx.tenantId, at: { gte: from, lt: to } }, orderBy: { at: "desc" } });
  const custs = await db.customer.findMany({ where: { id: { in: rows.map((r) => r.customerId) } }, select: { id: true, name: true } });
  const sms = await db.distSalesman.findMany({ where: { tenantId: ctx.tenantId } });
  return rows.map((r) => ({ ...r, amount: num(r.amountPaise), customer: custs.find((c) => c.id === r.customerId)?.name ?? "—", salesman: sms.find((s) => s.id === r.salesmanId)?.name ?? null }));
}
