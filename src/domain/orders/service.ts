import "server-only";
import { createHash, randomInt } from "node:crypto";
import { Prisma, type DeliveryOrder } from "@prisma/client";
import { db, type DbOrTx } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorize, authorizeView, can, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { nextSeq, pad } from "@/server/sequence";
import { hashCode, sameHash } from "@/server/otp";
import { putObject, getObject, ALLOWED } from "@/server/storage";
import { addDays, dateOnly, fiscalYear, isoOf, startOfTodayIST, todayISO } from "@/lib/dates";
import { big, cartTotals, inr } from "@/lib/money";
import { isH1 } from "@/lib/rx";
import { allocateFefo, fefoOrder } from "@/domain/inventory/fefo";
import { sellableByMedicine } from "@/domain/inventory/queries";
import { commitSale, reservedForDevices } from "@/domain/sales/service";
import { lockOpenShift, processReturn, voidable } from "@/domain/sales/returns";
import { voidSale } from "@/domain/sales/void";
import { postVoucher } from "@/domain/accounting/post";
import { ACC } from "@/domain/accounting/accounts";
import { deliverSchema, orderSchema, saleModeFor, STATUS_LABEL, type DeliverInput, type OrderInput, type OrderPay, type OrderStatus } from "./contracts";
import { notifyCustomer } from "./notify";

const OTP_TRIES = 5;
/** The sale billed for an order uses this idempotency key, so packing twice can never bill twice. */
export const saleKeyOf = (orderId: string) => "ord_" + orderId.replace(/-/g, "");

type Who = Pick<Ctx, "tenantId" | "userId" | "userName">;
const event = (q: DbOrTx, who: Who, o: { id: string; branchId: string }, kind: string, note?: string | null) =>
  q.deliveryEvent.create({ data: { tenantId: who.tenantId, branchId: o.branchId, orderId: o.id, kind, note: note?.slice(0, 300) ?? null, userId: who.userId, userName: who.userName } });
const audit = (q: DbOrTx, ctx: Ctx, o: { id: string; branchId: string; no: string }, action: string, detail?: string) =>
  writeAudit(q, { tenantId: ctx.tenantId, branchId: o.branchId, userId: ctx.userId, userName: ctx.userName, action, entity: "order", entityId: o.id, detail: detail ? `${o.no} · ${detail}` : o.no });

async function load(ctx: Ctx, id: string) {
  const o = await db.deliveryOrder.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { items: true } });
  if (!o || !ctx.branches.some((b) => b.id === o.branchId)) throw new UserError("Order not found.");
  return o;
}
const atBranch = (ctx: Ctx, o: { branchId: string }) => {
  if (o.branchId !== ctx.branchId) throw new UserError("Switch to the order’s branch to do this.");
};
const must = (o: { status: string; no: string }, ...ok: OrderStatus[]) => {
  if (!ok.includes(o.status as OrderStatus)) throw new UserError(`${o.no} is ${STATUS_LABEL[o.status as OrderStatus].toLowerCase()}; refresh to see its latest state.`);
};

/** Moves the order only if nobody else moved it first. */
async function move(q: DbOrTx, o: { id: string; no: string }, from: OrderStatus[], data: Prisma.DeliveryOrderUpdateManyMutationInput) {
  const r = await q.deliveryOrder.updateMany({ where: { id: o.id, status: { in: from } }, data });
  if (!r.count) throw new UserError(`${o.no} was just changed on another device. Refresh and try again.`);
}

// ───────────── Reading ─────────────

export type OrderView = Awaited<ReturnType<typeof listOrders>>[number];

export async function listOrders(ctx: Ctx, view: "open" | "done" = "open", q = "") {
  authorizeView(ctx, "sale");
  const term = q.trim();
  const rows = await db.deliveryOrder.findMany({
    where: {
      tenantId: ctx.tenantId, branchId: ctx.branchId,
      ...(view === "open" ? { status: { in: ["new", "confirmed", "packed", "out_for_delivery"] } } : { status: { in: ["delivered", "cancelled", "returned"] }, updatedAt: { gte: new Date(Date.now() - 30 * 86400_000) } }),
      ...(term ? { OR: [{ no: { contains: term, mode: "insensitive" } }, { name: { contains: term, mode: "insensitive" } }, { phone: { contains: term.replace(/\D/g, "") || term } }, { invoiceNo: { contains: term, mode: "insensitive" } }] } : {}),
    },
    include: { items: true }, orderBy: [{ slotDate: { sort: "asc", nulls: "last" } }, { createdAt: view === "open" ? "asc" : "desc" }], take: 200,
  });
  return shape(ctx.tenantId, ctx.branchId, rows);
}

async function shape(tenantId: string, branchId: string, rows: (DeliveryOrder & { items: { id: string; medicineId: string; qty: number }[] })[], withEvents = true) {
  const medIds = [...new Set(rows.flatMap((o) => o.items.map((i) => i.medicineId)))];
  const userIds = [...new Set(rows.map((o) => o.riderId).filter((x): x is string => !!x))];
  const [meds, users, stock, events] = await Promise.all([
    db.medicine.findMany({ where: { tenantId, id: { in: medIds } }, select: { id: true, name: true, strength: true, pack: true, schedule: true } }),
    db.user.findMany({ where: { tenantId, id: { in: userIds } }, select: { id: true, name: true, phone: true } }),
    sellableByMedicine(tenantId, branchId),
    withEvents ? db.deliveryEvent.findMany({ where: { tenantId, orderId: { in: rows.map((o) => o.id) } }, orderBy: { at: "asc" } }) : Promise.resolve([]),
  ]);
  return rows.map((o) => {
    const rider = users.find((u) => u.id === o.riderId);
    return {
      id: o.id, no: o.no, source: o.source, status: o.status as OrderStatus, name: o.name, phone: o.phone, address: o.address,
      slotDate: o.slotDate ? isoOf(o.slotDate) : null, slot: o.slot, notes: o.notes, payMode: o.payMode as OrderPay, payRef: o.payRef,
      discountPct: Number(o.discountPct), prescriber: o.prescriber, hasRx: !!o.rxPath, waConsent: o.waConsent,
      estimate: big(o.estimatePaise), total: o.totalPaise == null ? null : big(o.totalPaise), saleId: o.saleId, invoiceNo: o.invoiceNo,
      rider: rider ? { id: rider.id, name: rider.name, phone: rider.phone } : null, proof: o.proof, receivedBy: o.receivedBy,
      collected: big(o.collectedPaise), collectedMode: o.collectedMode, settled: !!o.settlementId, reason: o.reason,
      createdAt: o.createdAt.toISOString(), deliveredAt: o.deliveredAt?.toISOString() ?? null,
      items: o.items.map((i) => { const m = meds.find((x) => x.id === i.medicineId); return { medicineId: i.medicineId, name: m ? `${m.name} ${m.strength}`.trim() : "Unknown", pack: m?.pack ?? "", schedule: m?.schedule ?? null, qty: i.qty, available: stock.get(i.medicineId) ?? 0 }; }),
      events: events.filter((e) => e.orderId === o.id).map((e) => ({ id: e.id, kind: e.kind, note: e.note, by: e.userName, at: e.at.toISOString() })),
    };
  });
}

export async function orderCounts(ctx: Ctx) {
  const rows = await db.deliveryOrder.groupBy({ by: ["status"], where: { tenantId: ctx.tenantId, branchId: ctx.branchId, status: { in: ["new", "confirmed", "packed", "out_for_delivery"] } }, _count: true });
  return Object.fromEntries(rows.map((r) => [r.status, r._count])) as Partial<Record<OrderStatus, number>>;
}

/** Active users who can deliver at this branch. */
export async function riders(ctx: Ctx) {
  authorizeView(ctx, "sale");
  const us = await db.user.findMany({ where: { tenantId: ctx.tenantId, active: true, isSupport: false, role: { permissions: { has: "delivery" } } }, select: { id: true, name: true, phone: true, branchIds: true, role: { select: { name: true } } }, orderBy: { name: "asc" } });
  return us.filter((u) => !u.branchIds.length || u.branchIds.includes(ctx.branchId)).map((u) => ({ id: u.id, name: u.name, phone: u.phone, role: u.role.name }));
}

// ───────────── Taking an order ─────────────

export async function createOrder(ctx: Ctx, raw: OrderInput) {
  authorize(ctx, "sale");
  const i = orderSchema.parse(raw);
  if (i.payMode === "credit" && !can(ctx, "credit")) throw new UserError("Your role cannot take orders on credit.");
  if (i.slotDate && i.slotDate < todayISO()) throw new UserError("The delivery date is in the past.");
  const qty = new Map<string, number>();
  for (const it of i.items) qty.set(it.medicineId, (qty.get(it.medicineId) ?? 0) + it.qty);
  const meds = await db.medicine.findMany({ where: { tenantId: ctx.tenantId, id: { in: [...qty.keys()] }, active: true } });
  if (meds.length !== qty.size) throw new UserError("An item is no longer in the catalogue. Remove it and search again.");
  const rx = meds.filter((m) => m.schedule);
  if (rx.length && !i.prescriber) throw new UserError(`Enter the prescriber’s name: ${rx.map((m) => m.name).join(", ")} ${rx.length > 1 ? "are" : "is"} Schedule ${rx[0].schedule}.`);
  const h1 = meds.filter((m) => isH1(m.schedule));
  if (h1.length && !i.prescriberReg) throw new UserError(`Enter the prescriber’s registration no.: ${h1.map((m) => m.name).join(", ")} ${h1.length > 1 ? "go" : "goes"} in the Schedule H1 register.`);
  const batches = await db.batch.findMany({ where: { tenantId: ctx.tenantId, branchId: ctx.branchId, medicineId: { in: [...qty.keys()] } } });
  const est = cartTotals(meds.map((m) => ({ mrpPaise: big(fefoOrder(batches, m.id)[0]?.mrpPaise ?? m.mrpPaise), qty: qty.get(m.id)!, gstRate: m.gstRate })), i.discountPct);

  const o = await db.$transaction(async (tx) => {
    let customer = i.customerId ? await tx.customer.findFirst({ where: { id: i.customerId, tenantId: ctx.tenantId, erasedAt: null } }) : await tx.customer.findFirst({ where: { tenantId: ctx.tenantId, phone: i.phone, erasedAt: null } });
    if (i.customerId && !customer) throw new UserError("Customer not found.");
    if (!customer) {
      if (await tx.customer.findFirst({ where: { tenantId: ctx.tenantId, phone: i.phone } })) throw new UserError("This mobile number belongs to an erased customer record. Use another number.");
      customer = await tx.customer.create({ data: { tenantId: ctx.tenantId, name: i.name, phone: i.phone, waOptIn: i.waConsent, optInAt: i.waConsent ? new Date() : null, optInMethod: i.waConsent ? `Order by ${i.source.replace("_", "-")}, recorded by ${ctx.userName}` : null } });
      await writeAudit(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: "Customer added", entity: "customer", entityId: customer.id, detail: `${customer.name} · from an order${customer.waOptIn ? " · WhatsApp opt-in" : ""}` });
    }
    if (i.payMode === "credit" && big(customer.creditLimitPaise) <= 0) throw new UserError(`${customer.name} has no credit limit. Set one under Suppliers & customers, or choose another payment.`);
    const fy = fiscalYear();
    const no = `ORD-${fy}-${pad(await nextSeq(tx, ctx.tenantId, "ORD:" + fy), 5)}`;
    const o = await tx.deliveryOrder.create({
      data: {
        tenantId: ctx.tenantId, branchId: ctx.branchId, no, source: i.source, customerId: customer.id, name: i.name, phone: i.phone, address: i.address,
        slotDate: i.slotDate ? dateOnly(i.slotDate) : null, slot: i.slot || null, notes: i.notes || null, payMode: i.payMode, payRef: i.payRef || null,
        discountPct: new Prisma.Decimal(i.discountPct), prescriber: i.prescriber || null, prescriberReg: h1.length ? i.prescriberReg || null : null, waConsent: i.waConsent, estimatePaise: BigInt(est.total), createdBy: ctx.userId,
        items: { create: [...qty].map(([medicineId, q]) => ({ medicineId, qty: q })) },
      },
    });
    await event(tx, ctx, o, "new", `${i.source.replace("_", "-")} order · ${qty.size} item${qty.size > 1 ? "s" : ""}`);
    await audit(tx, ctx, o, "Order created", `${o.name} · ${inr(est.total)} est. · ${i.payMode.toUpperCase()}`);
    return o;
  });
  return { id: o.id, no: o.no };
}

export async function confirmOrder(ctx: Ctx, id: string) {
  authorize(ctx, "sale");
  const o = await load(ctx, id);
  atBranch(ctx, o);
  must(o, "new");
  const short = await shortages(ctx, o.items);
  await db.$transaction(async (tx) => {
    await move(tx, o, ["new"], { status: "confirmed" });
    await event(tx, ctx, o, "confirmed", short.length ? `Short now: ${short.join(", ")}` : null);
    await audit(tx, ctx, o, "Order confirmed");
  });
  const channel = await notifyCustomer(o, "confirmed");
  return { channel, short };
}

async function shortages(ctx: Ctx, items: { medicineId: string; qty: number }[]) {
  const [stock, meds] = await Promise.all([sellableByMedicine(ctx.tenantId, ctx.branchId), db.medicine.findMany({ where: { id: { in: items.map((i) => i.medicineId) } }, select: { id: true, name: true } })]);
  return items.filter((i) => (stock.get(i.medicineId) ?? 0) < i.qty).map((i) => `${meds.find((m) => m.id === i.medicineId)?.name ?? "item"} (${stock.get(i.medicineId) ?? 0} of ${i.qty})`);
}

/**
 * Packs and bills the order through the POS commit: FEFO batches, Rx rule, discount cap, credit limit,
 * stock lock, invoice number, sales voucher. Cash on delivery is billed to "Cash with delivery staff".
 */
export async function packOrder(ctx: Ctx, id: string) {
  authorize(ctx, "sale");
  const o = await load(ctx, id);
  atBranch(ctx, o);
  must(o, "confirmed");
  const key = saleKeyOf(o.id);
  const prior = await db.sale.findUnique({ where: { tenantId_idempotencyKey: { tenantId: ctx.tenantId, idempotencyKey: key } } });
  let billed = prior ? { saleId: prior.id, invoiceNo: prior.invoiceNo, total: big(prior.totalPaise) } : null;
  if (!billed) {
    const [batches, reserved, meds] = await Promise.all([
      db.batch.findMany({ where: { tenantId: ctx.tenantId, branchId: ctx.branchId, medicineId: { in: o.items.map((i) => i.medicineId) } } }),
      reservedForDevices(db, ctx.tenantId, ctx.branchId),
      db.medicine.findMany({ where: { id: { in: o.items.map((i) => i.medicineId) } }, select: { id: true, name: true } }),
    ]);
    const free = batches.map((b) => ({ ...b, qtyAvailable: b.qtyAvailable - Math.min(reserved.get(b.id) ?? 0, b.qtyAvailable) }));
    const lines = o.items.flatMap((it) => {
      try { return allocateFefo(free, it.medicineId, it.qty).map((a) => ({ medicineId: it.medicineId, batchId: a.batch.id, qty: a.qty })); }
      catch (e) { throw new UserError(`${meds.find((m) => m.id === it.medicineId)?.name ?? "An item"}: ${(e as Error).message.toLowerCase()}, ${it.qty} ordered. Restock or cancel the order.`); }
    });
    billed = await commitSale(ctx, {
      idempotencyKey: key, lines, customerId: o.customerId, discountPct: Number(o.discountPct),
      pay: { mode: saleModeFor(o.payMode as OrderPay), ...(o.payRef ? { ref: o.payRef } : {}) }, ...(o.prescriber ? { prescriber: o.prescriber } : {}), ...(o.prescriberReg ? { prescriberReg: o.prescriberReg, patientName: o.name } : {}),
    }, { cod: true, note: `order ${o.no}` });
  }
  const sale = billed;
  await db.$transaction(async (tx) => {
    await move(tx, o, ["confirmed"], { status: "packed", saleId: sale.saleId, invoiceNo: sale.invoiceNo, totalPaise: BigInt(sale.total) });
    await event(tx, ctx, o, "packed", `Invoice ${sale.invoiceNo} · ${inr(sale.total)}`);
    await audit(tx, ctx, o, "Order packed and billed", `${sale.invoiceNo} · ${inr(sale.total)}`);
  });
  return sale;
}

async function riderOf(ctx: Ctx, riderId: string) {
  const r = (await riders(ctx)).find((x) => x.id === riderId);
  if (!r) throw new UserError("Choose a delivery person who works at this branch.");
  return r;
}

/** Hands the parcel to a rider and sends the customer a 4-digit delivery code. */
export async function dispatchOrder(ctx: Ctx, id: string, riderId: string) {
  authorize(ctx, "sale");
  const o = await load(ctx, id);
  atBranch(ctx, o);
  must(o, "packed");
  const rider = await riderOf(ctx, riderId);
  const otp = String(randomInt(0, 10_000)).padStart(4, "0");
  await db.$transaction(async (tx) => {
    await move(tx, o, ["packed"], { status: "out_for_delivery", riderId: rider.id, otpHash: hashCode("order:" + o.id, otp), otpAttempts: 0, reason: null });
    await event(tx, ctx, o, "out_for_delivery", `With ${rider.name}`);
    await audit(tx, ctx, o, "Order out for delivery", rider.name);
  });
  const channel = await notifyCustomer({ ...o, totalPaise: o.totalPaise }, "out_for_delivery", { otp, rider: rider.name });
  return { channel, rider: rider.name };
}

export async function reassignRider(ctx: Ctx, id: string, riderId: string) {
  authorize(ctx, "sale");
  const o = await load(ctx, id);
  atBranch(ctx, o);
  must(o, "out_for_delivery");
  const rider = await riderOf(ctx, riderId);
  if (rider.id === o.riderId) return;
  await db.$transaction(async (tx) => {
    await move(tx, o, ["out_for_delivery"], { riderId: rider.id });
    await event(tx, ctx, o, "rider_assigned", `Now with ${rider.name}`);
    await audit(tx, ctx, o, "Order rider changed", rider.name);
  });
}

// ───────────── At the door ─────────────

/** The assigned rider, or a manager (refunds permission) acting for them. */
function riderMay(ctx: Ctx, o: { riderId: string | null }) {
  if (can(ctx, "delivery") && o.riderId === ctx.userId) { authorize(ctx, "delivery"); return; }
  authorize(ctx, "refund");
}

export async function deliverOrder(ctx: Ctx, id: string, raw: DeliverInput) {
  const i = deliverSchema.parse(raw);
  const o = await load(ctx, id);
  riderMay(ctx, o);
  must(o, "out_for_delivery");
  let proof: "otp" | "signature";
  if (i.otp) {
    if (!o.otpHash) throw new UserError("No delivery code was sent for this order. Enter the receiver’s name instead.");
    if (o.otpAttempts >= OTP_TRIES) throw new UserError("Too many wrong codes. Enter the receiver’s name instead.");
    if (!/^\d{4}$/.test(i.otp) || !sameHash(o.otpHash, hashCode("order:" + o.id, i.otp))) {
      await db.deliveryOrder.updateMany({ where: { id: o.id, status: "out_for_delivery" }, data: { otpAttempts: { increment: 1 } } });
      const left = OTP_TRIES - o.otpAttempts - 1;
      throw new UserError(left > 0 ? `Wrong code. ${left} ${left === 1 ? "try" : "tries"} left.` : "Wrong code. Enter the receiver’s name instead.");
    }
    proof = "otp";
  } else {
    if ((i.receivedBy ?? "").length < 2) throw new UserError("Enter the delivery code from the customer, or the name of the person who received it.");
    proof = "signature";
  }
  const due = o.payMode === "cod" ? big(o.totalPaise) : 0;
  if (o.payMode === "cod" && i.collected !== due) throw new UserError(`Collect ${inr(due)}, the invoice total, before marking it delivered.`);
  const collected = o.payMode === "cod" ? due : 0;
  await db.$transaction(async (tx) => {
    await move(tx, o, ["out_for_delivery"], {
      status: "delivered", deliveredAt: new Date(), proof, receivedBy: i.receivedBy || null, otpHash: null,
      collectedPaise: BigInt(collected), collectedMode: collected ? i.collectedMode : null, reason: null,
    });
    // UPI at the door goes straight to the bank; cash stays with the rider until handed over.
    if (collected && i.collectedMode === "upi") await postVoucher(tx, {
      tenantId: ctx.tenantId, branchId: o.branchId, type: "receipt", userId: ctx.userId, refType: "delivery_upi", refId: o.id,
      narration: `UPI collected at the door · ${o.no} · ${o.invoiceNo ?? ""}`, lines: [{ account: ACC.bank, dr: collected }, { account: ACC.codClearing, cr: collected }],
    });
    const how = proof === "otp" ? "delivery code" : `received by ${i.receivedBy}`;
    await event(tx, ctx, o, "delivered", `${how}${collected ? ` · ${inr(collected)} ${i.collectedMode.toUpperCase()}` : ""}`);
    await audit(tx, ctx, o, "Order delivered", `${how}${collected ? ` · collected ${inr(collected)} ${i.collectedMode.toUpperCase()}` : ""}`);
  });
  await notifyCustomer(o, "delivered");
}

export async function failedAttempt(ctx: Ctx, id: string, reason: string) {
  const o = await load(ctx, id);
  riderMay(ctx, o);
  must(o, "out_for_delivery");
  const r = reason.trim();
  if (r.length < 3) throw new UserError("Say why it couldn’t be delivered.");
  await db.$transaction(async (tx) => {
    await move(tx, o, ["out_for_delivery"], { reason: r.slice(0, 200) });
    await event(tx, ctx, o, "attempt_failed", r);
    await audit(tx, ctx, o, "Delivery attempt failed", r.slice(0, 120));
  });
}

// ───────────── Cancelling and returns ─────────────

/** Reverses the order's bill: a same-day void, or a credit note that restocks it. Safe to repeat. */
async function reverseBill(ctx: Ctx, o: DeliveryOrder, reason: string) {
  if (!o.saleId) return null;
  const sale = await db.sale.findFirst({ where: { id: o.saleId, tenantId: ctx.tenantId }, include: { items: true, voided: true } });
  if (!sale || sale.voided) return null;
  const left = sale.items.filter((it) => it.qty > it.returnedQty);
  if (!left.length) return null;
  const why = `Order ${o.no}: ${reason}`.slice(0, 200);
  if (voidable(sale)) { await voidSale(ctx, sale.id, why); return `voided ${sale.invoiceNo}`; }
  const r = await processReturn(ctx, {
    saleId: sale.id, lines: left.map((it) => ({ itemId: it.id, qty: it.qty - it.returnedQty })), condition: "sealed",
    refundMode: sale.payMode === "upi" ? "UPI refund" : sale.payMode === "credit" ? "Adjust customer credit" : "Cash", reason: why,
  }, { codUncollected: true });
  return `credit note ${r.creditNote}`;
}

export async function cancelOrder(ctx: Ctx, id: string, reason: string) {
  const r = reason.trim();
  if (r.length < 3) throw new UserError("Enter the reason for cancelling.");
  const o = await load(ctx, id);
  atBranch(ctx, o);
  must(o, "new", "confirmed", "packed");
  if (o.status === "packed") authorize(ctx, "refund"); else authorize(ctx, "sale");
  const undo = o.status === "packed" ? await reverseBill(ctx, o, r) : null;
  await db.$transaction(async (tx) => {
    await move(tx, o, [o.status as OrderStatus], { status: "cancelled", reason: r.slice(0, 200), otpHash: null });
    await event(tx, ctx, o, "cancelled", `${r}${undo ? " · " + undo : ""}`);
    await audit(tx, ctx, o, "Order cancelled", `${r.slice(0, 120)}${undo ? " · " + undo : ""}`);
  });
  return { undo };
}

/** Goods came back undelivered: the bill is reversed and the stock goes back on the shelf. */
export async function returnOrder(ctx: Ctx, id: string, reason: string) {
  authorize(ctx, "refund");
  const r = reason.trim();
  if (r.length < 3) throw new UserError("Enter why the order came back.");
  const o = await load(ctx, id);
  atBranch(ctx, o);
  must(o, "out_for_delivery");
  const undo = await reverseBill(ctx, o, r);
  await db.$transaction(async (tx) => {
    await move(tx, o, ["out_for_delivery"], { status: "returned", reason: r.slice(0, 200), otpHash: null });
    await event(tx, ctx, o, "returned", `${r}${undo ? " · " + undo : ""}`);
    await audit(tx, ctx, o, "Order returned undelivered", `${r.slice(0, 120)}${undo ? " · " + undo : ""}`);
  });
  return { undo };
}

// ───────────── Prescription ─────────────

export async function attachRx(ctx: Ctx, id: string, bytes: Buffer, mime: keyof typeof ALLOWED) {
  authorize(ctx, "sale");
  const o = await load(ctx, id);
  if (!["new", "confirmed", "packed"].includes(o.status)) throw new UserError("Attach the prescription before the order leaves the store.");
  const sha = createHash("sha256").update(bytes).digest("hex");
  const rel = `${ctx.tenantId}/rx/${sha}.${ALLOWED[mime]}`;
  await putObject(rel, bytes, mime);
  await db.$transaction(async (tx) => {
    await tx.deliveryOrder.update({ where: { id: o.id }, data: { rxPath: rel, rxMime: mime } });
    await event(tx, ctx, o, "rx_uploaded", sha.slice(0, 12));
    await audit(tx, ctx, o, "Prescription attached", sha.slice(0, 12));
  });
}

export async function readRx(ctx: Ctx, id: string) {
  const o = await db.deliveryOrder.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!o?.rxPath || !ctx.branches.some((b) => b.id === o.branchId)) return null;
  if (!can(ctx, "sale") && o.riderId !== ctx.userId) return null;
  const bytes = await getObject(o.rxPath);
  return bytes ? { bytes, mime: o.rxMime ?? "application/octet-stream", name: `${o.no}-rx.${o.rxPath.split(".").pop()}` } : null;
}

// ───────────── Rider ─────────────

export async function myDeliveries(ctx: Ctx) {
  authorizeView(ctx, "delivery");
  const branches = ctx.branches.map((b) => b.id);
  const [open, today, cash] = await Promise.all([
    db.deliveryOrder.findMany({ where: { tenantId: ctx.tenantId, riderId: ctx.userId, status: "out_for_delivery", branchId: { in: branches } }, include: { items: true }, orderBy: [{ slotDate: { sort: "asc", nulls: "last" } }, { updatedAt: "asc" }] }),
    db.deliveryOrder.findMany({ where: { tenantId: ctx.tenantId, riderId: ctx.userId, status: { in: ["delivered", "returned"] }, updatedAt: { gte: startOfTodayIST() } }, include: { items: true }, orderBy: { updatedAt: "desc" } }),
    db.deliveryOrder.aggregate({ where: { tenantId: ctx.tenantId, riderId: ctx.userId, status: "delivered", collectedMode: "cash", settlementId: null }, _sum: { collectedPaise: true }, _count: true }),
  ]);
  const shaped = async (rows: typeof open) => (await Promise.all(ctx.branches.filter((b) => rows.some((o) => o.branchId === b.id)).map((b) => shape(ctx.tenantId, b.id, rows.filter((o) => o.branchId === b.id), false)))).flat();
  return { open: await shaped(open), done: await shaped(today), cashInHand: big(cash._sum.collectedPaise), cashOrders: cash._count };
}

// ───────────── Cash handover ─────────────

export async function riderCash(ctx: Ctx) {
  authorizeView(ctx, "sale");
  const rows = await db.deliveryOrder.findMany({ where: { tenantId: ctx.tenantId, branchId: ctx.branchId, status: "delivered", collectedMode: "cash", settlementId: null }, orderBy: { deliveredAt: "asc" } });
  const users = await db.user.findMany({ where: { tenantId: ctx.tenantId, id: { in: [...new Set(rows.map((r) => r.riderId!))] } }, select: { id: true, name: true } });
  return users.map((u) => {
    const mine = rows.filter((r) => r.riderId === u.id);
    return { riderId: u.id, name: u.name, total: mine.reduce((a, r) => a + big(r.collectedPaise), 0), orders: mine.map((r) => ({ id: r.id, no: r.no, invoiceNo: r.invoiceNo, name: r.name, amount: big(r.collectedPaise), deliveredAt: r.deliveredAt?.toISOString() ?? null })) };
  });
}

/**
 * Takes a rider's cash on delivery into this counter's drawer: Dr Cash (counted) / Cr Cash with delivery
 * staff (expected); a difference goes to Cash short/excess. The cash joins the open shift's expected total.
 */
export async function settleRider(ctx: Ctx, riderId: string, countedRupees: string, note = "") {
  authorize(ctx, "sale");
  if (countedRupees.trim() === "" || !(parseFloat(countedRupees) >= 0)) throw new UserError("Count the cash and enter the amount.");
  const counted = Math.round(parseFloat(countedRupees) * 100);
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string; no: string; amt: bigint }[]>`
      SELECT id, no, "collectedPaise" amt FROM "DeliveryOrder" WHERE "tenantId" = ${ctx.tenantId} AND "branchId" = ${ctx.branchId} AND "riderId" = ${riderId}
        AND status = 'delivered' AND "collectedMode" = 'cash' AND "settlementId" IS NULL ORDER BY id FOR UPDATE`;
    if (!rows.length) throw new UserError("This delivery person has no cash to hand over.");
    const rider = await tx.user.findFirst({ where: { id: riderId, tenantId: ctx.tenantId }, select: { name: true } });
    const expected = rows.reduce((a, r) => a + Number(r.amt), 0), diff = counted - expected;
    if (diff && note.trim().length < 3) throw new UserError(`The count is ${inr(Math.abs(diff))} ${diff < 0 ? "short" : "over"}. Add a note explaining the difference.`);
    const fy = fiscalYear();
    const no = `RS-${fy}-${pad(await nextSeq(tx, ctx.tenantId, "RS:" + fy))}`;
    const shift = await lockOpenShift(tx, ctx);
    const s = await tx.riderSettlement.create({ data: { tenantId: ctx.tenantId, branchId: ctx.branchId, no, riderId, orderIds: rows.map((r) => r.id), expectedPaise: BigInt(expected), countedPaise: BigInt(counted), shiftId: shift?.id ?? null, userId: ctx.userId, note: note.trim().slice(0, 200) || null } });
    await tx.deliveryOrder.updateMany({ where: { id: { in: rows.map((r) => r.id) } }, data: { settlementId: s.id } });
    await postVoucher(tx, {
      tenantId: ctx.tenantId, branchId: ctx.branchId, type: "receipt", userId: ctx.userId, refType: "rider_settlement", refId: s.id,
      narration: `${no} · cash on delivery from ${rider?.name ?? "delivery staff"} · ${rows.length} order${rows.length > 1 ? "s" : ""}`,
      lines: [{ account: ACC.cash, dr: counted }, diff < 0 ? { account: ACC.cashDiff, dr: -diff } : { account: ACC.cashDiff, cr: diff }, { account: ACC.codClearing, cr: expected }],
    });
    await writeAudit(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: "Delivery cash handed over", entity: "rider_settlement", entityId: s.id, detail: `${no} · ${rider?.name ?? riderId} · expected ${inr(expected)} · counted ${inr(counted)}${diff ? ` · ${diff < 0 ? "short" : "over"} ${inr(Math.abs(diff))}` : ""}` });
    return { no, expected, counted, diff, orders: rows.length };
  });
}

export async function recentSettlements(ctx: Ctx) {
  authorizeView(ctx, "sale");
  const rows = await db.riderSettlement.findMany({ where: { tenantId: ctx.tenantId, branchId: ctx.branchId, at: { gte: new Date(dateOnly(addDays(todayISO(), -14)).getTime()) } }, orderBy: { at: "desc" }, take: 50 });
  const users = await db.user.findMany({ where: { tenantId: ctx.tenantId, id: { in: [...new Set(rows.flatMap((r) => [r.riderId, r.userId]))] } }, select: { id: true, name: true } });
  const nm = (id: string) => users.find((u) => u.id === id)?.name ?? "";
  return rows.map((r) => ({ id: r.id, no: r.no, rider: nm(r.riderId), by: nm(r.userId), orders: r.orderIds.length, expected: big(r.expectedPaise), counted: big(r.countedPaise), note: r.note, at: r.at.toISOString() }));
}
