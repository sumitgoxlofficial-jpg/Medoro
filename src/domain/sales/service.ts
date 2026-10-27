import "server-only";
import { Prisma } from "@prisma/client";
import { db, type Tx } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorize, can, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { nextSeq } from "@/server/sequence";
import { daysTo, fiscalYear, todayISO } from "@/lib/dates";
import { big, cartTotals, inr, inr0 } from "@/lib/money";
import { discountCap } from "@/domain/identity/permissions";
import { postVoucher, type Line } from "@/domain/accounting/post";
import { ACC } from "@/domain/accounting/accounts";
import { customerBalance } from "@/domain/parties/balances";
import { saleSchema, customerSchema, type SaleInput, type CustomerInput } from "./contracts";

export type CommitResult = { saleId: string; invoiceNo: string; total: number; replayed: boolean };

/**
 * Commits a sale atomically. Everything the client sends is re-validated here:
 * stock (row-locked), batch eligibility, prices from the database, discount cap,
 * prescription rule, credit permission and limit. Same idempotency key → same sale.
 */
export async function commitSale(ctx: Ctx, raw: SaleInput): Promise<CommitResult> {
  authorize(ctx, "sale");
  const input = saleSchema.parse(raw);
  const existing = await db.sale.findUnique({ where: { tenantId_idempotencyKey: { tenantId: ctx.tenantId, idempotencyKey: input.idempotencyKey } } });
  if (existing) return { saleId: existing.id, invoiceNo: existing.invoiceNo, total: big(existing.totalPaise), replayed: true };
  try {
    return await db.$transaction((tx) => commitTx(tx, ctx, input), { timeout: 15000 });
  } catch (e) {
    // A concurrent request with the same key won the race: return its result.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const s = await db.sale.findUnique({ where: { tenantId_idempotencyKey: { tenantId: ctx.tenantId, idempotencyKey: input.idempotencyKey } } });
      if (s) return { saleId: s.id, invoiceNo: s.invoiceNo, total: big(s.totalPaise), replayed: true };
    }
    throw e;
  }
}

async function commitTx(tx: Tx, ctx: Ctx, input: SaleInput): Promise<CommitResult> {
  const today = todayISO();
  const ids = [...new Set(input.lines.map((l) => l.batchId))];
  // Lock the batches so two counters can't sell the same last unit.
  await tx.$queryRaw`SELECT id FROM "Batch" WHERE id IN (${Prisma.join(ids)}) AND "tenantId" = ${ctx.tenantId} ORDER BY id FOR UPDATE`;
  const batches = await tx.batch.findMany({ where: { id: { in: ids }, tenantId: ctx.tenantId }, include: { medicine: true } });
  const byId = new Map(batches.map((b) => [b.id, b]));
  const need = new Map<string, number>();
  for (const l of input.lines) {
    const b = byId.get(l.batchId);
    if (!b || b.branchId !== ctx.branchId || b.medicineId !== l.medicineId) throw new UserError("A cart line doesn’t match this branch’s stock. Review the cart.");
    need.set(b.id, (need.get(b.id) ?? 0) + l.qty);
  }
  for (const [id, q] of need) {
    const b = byId.get(id)!;
    if (b.status !== "ok") throw new UserError(`${b.medicine.name} batch ${b.batchNo} is ${b.status === "quarantine" ? "quarantined" : b.status} and blocked from sale.`);
    if (daysTo(b.expiryDate, today) <= 0) throw new UserError(`${b.medicine.name} batch ${b.batchNo} has expired and is blocked from sale.`);
    if (b.qtyAvailable < q) throw new UserError(`Stock changed on another device: only ${b.qtyAvailable} of ${b.medicine.name} (${b.batchNo}) left. Review the cart.`);
  }

  const cap = discountCap(ctx.perms);
  if (input.discountPct > cap) throw new UserError(`Discount above ${cap}% needs manager approval.`);
  const rx = input.lines.some((l) => byId.get(l.batchId)!.medicine.schedule);
  if (rx && !input.prescriber?.trim()) throw new UserError("Enter the prescriber’s name for Schedule H/H1 items.");

  const lines = input.lines.map((l) => { const b = byId.get(l.batchId)!; return { b, qty: l.qty }; });
  const t = cartTotals(lines.map(({ b, qty }) => ({ mrpPaise: big(b.mrpPaise), qty, gstRate: b.medicine.gstRate, costPaise: big(b.costPaise) })), input.discountPct);
  if (t.total <= 0) throw new UserError("The bill total must be more than zero.");

  const customer = input.customerId ? await tx.customer.findFirst({ where: { id: input.customerId, tenantId: ctx.tenantId, erasedAt: null } }) : null;
  if (input.customerId && !customer) throw new UserError("Customer not found.");

  const pay = { cash: 0, upi: 0, card: 0, credit: 0 };
  const m = input.pay.mode;
  if (m === "split") {
    const cash = input.pay.cashPaise ?? -1;
    if (cash <= 0 || cash >= t.total) throw new UserError("Enter a cash part between ₹1 and the bill total.");
    pay.cash = cash; pay.upi = t.total - cash;
  } else if (m === "credit") {
    if (!can(ctx, "credit")) throw new UserError("Your role cannot make credit sales.");
    if (!customer) throw new UserError("Select a customer for a credit sale.");
    const due = await customerBalance(tx, ctx.tenantId, customer.id);
    if (due + t.total > big(customer.creditLimitPaise)) throw new UserError(`Exceeds ${customer.name}’s credit limit (${inr0(big(customer.creditLimitPaise))}, ${inr0(due)} already due).`);
    pay.credit = t.total;
  } else {
    if (m === "cash" && input.pay.tenderedPaise && input.pay.tenderedPaise < t.total) throw new UserError("Cash tendered is less than the total.");
    pay[m] = t.total;
  }

  const branch = await tx.branch.findUniqueOrThrow({ where: { id: ctx.branchId } });
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
  const fy = fiscalYear(today);
  const n = await nextSeq(tx, ctx.tenantId, `INV:${ctx.branchId}:${fy}`);
  const prefix = (tenant.settings as { invoicePrefix?: string }).invoicePrefix ?? "INV";
  const invoiceNo = `${prefix}/${branch.code}/${fy}/${String(n).padStart(6, "0")}`;
  const shift = await tx.shift.findFirst({ where: { tenantId: ctx.tenantId, branchId: ctx.branchId, closedAt: null, ...(ctx.counterId ? { counter: ctx.counterId } : { openedBy: ctx.userId }) } });

  const sale = await tx.sale.create({
    data: {
      tenantId: ctx.tenantId, branchId: ctx.branchId, invoiceNo, idempotencyKey: input.idempotencyKey, customerId: customer?.id ?? null,
      prescriber: rx ? input.prescriber!.trim() : input.prescriber?.trim() || null, rxNo: input.rxNo?.trim() || null,
      subtotalPaise: BigInt(t.mrpTotal), discountPaise: BigInt(t.discount), discountPct: new Prisma.Decimal(input.discountPct), taxablePaise: BigInt(t.taxable),
      cgstPaise: BigInt(t.cgst), sgstPaise: BigInt(t.sgst), roundOffPaise: BigInt(t.roundOff), totalPaise: BigInt(t.total), costPaise: BigInt(t.cost),
      payMode: m, shiftId: shift?.id ?? null, userId: ctx.userId,
      items: { create: lines.map(({ b, qty }, i) => ({ batchId: b.id, medicineId: b.medicineId, qty, mrpPaise: b.mrpPaise, discountPaise: BigInt(t.lines[i].discount), taxablePaise: BigInt(t.lines[i].taxable), gstRate: b.medicine.gstRate, costPaise: b.costPaise })) },
      payments: { create: (Object.entries(pay) as [keyof typeof pay, number][]).filter(([, a]) => a > 0).map(([mode, a]) => ({ mode, amountPaise: BigInt(a), ref: mode === "cash" ? null : input.pay.ref || null })) },
    },
  });
  for (const [id, q] of need) {
    const r = await tx.batch.updateMany({ where: { id, qtyAvailable: { gte: q } }, data: { qtyAvailable: { decrement: q }, version: { increment: 1 } } });
    if (!r.count) throw new UserError("Stock changed on another device. Review the cart.");
  }
  await tx.stockMovement.createMany({ data: lines.map(({ b, qty }) => ({ tenantId: ctx.tenantId, branchId: ctx.branchId, batchId: b.id, qty: -qty, type: "sale", refType: "sale", refId: sale.id, userId: ctx.userId, note: invoiceNo })) });

  const vl: Line[] = [
    { account: ACC.cash, dr: pay.cash }, { account: ACC.bank, dr: pay.upi + pay.card },
    ...(pay.credit ? [{ account: ACC.debtors, dr: pay.credit, partyType: "customer" as const, partyId: customer!.id }] : []),
    { account: ACC.sales, cr: t.taxable }, { account: ACC.cgst, cr: t.cgst }, { account: ACC.sgst, cr: t.sgst },
    t.roundOff >= 0 ? { account: ACC.roundOff, cr: t.roundOff } : { account: ACC.roundOff, dr: -t.roundOff },
  ];
  await postVoucher(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, type: "sales", narration: `Sale ${invoiceNo}${customer ? " · " + customer.name : ""}`, userId: ctx.userId, refType: "sale", refId: sale.id, lines: vl });
  await writeAudit(tx, {
    tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: "Sale committed", entity: "sale", entityId: sale.id,
    detail: `${invoiceNo} · ${inr(t.total)} · ${m.toUpperCase()}${input.discountPct ? ` · discount ${input.discountPct}%` : ""}${rx ? " · Rx" : ""}`,
  });
  return { saleId: sale.id, invoiceNo, total: t.total, replayed: false };
}

/** Everything needed to print or show an invoice. */
export async function invoiceData(ctx: Ctx, saleId: string) {
  const s = await db.sale.findFirst({ where: { id: saleId, tenantId: ctx.tenantId }, include: { items: true, payments: true, customer: true } });
  if (!s) return null;
  const [branch, tenant, meds, batches, user] = await Promise.all([
    db.branch.findUniqueOrThrow({ where: { id: s.branchId } }),
    db.tenant.findUniqueOrThrow({ where: { id: s.tenantId } }),
    db.medicine.findMany({ where: { id: { in: s.items.map((i) => i.medicineId) } } }),
    db.batch.findMany({ where: { id: { in: s.items.map((i) => i.batchId) } } }),
    db.user.findUnique({ where: { id: s.userId }, select: { name: true } }),
  ]);
  return {
    id: s.id, invoiceNo: s.invoiceNo, at: s.at.toISOString(), payMode: s.payMode, prescriber: s.prescriber, rxNo: s.rxNo, cashier: user?.name ?? "",
    pharmacy: { name: tenant.name, legalName: tenant.legalName, gstin: branch.gstin ?? tenant.gstin, address: branch.address, dl: branch.drugLicence, phone: tenant.phone, pharmacist: (tenant.settings as { pharmacist?: string }).pharmacist ?? "" },
    customer: s.customer ? { name: s.customer.name, phone: s.customer.phone, optIn: s.customer.waOptIn } : null,
    lines: s.items.map((i) => {
      const m = meds.find((x) => x.id === i.medicineId)!, b = batches.find((x) => x.id === i.batchId)!;
      return { name: m.name, pack: m.pack, hsn: m.hsn, schedule: m.schedule, batchNo: b.batchNo, expiry: b.expiryDate.toISOString().slice(0, 10), qty: i.qty, mrp: big(i.mrpPaise), amount: big(i.mrpPaise) * i.qty, discount: big(i.discountPaise), taxable: big(i.taxablePaise), gstRate: i.gstRate };
    }),
    totals: { mrp: big(s.subtotalPaise), discount: big(s.discountPaise), taxable: big(s.taxablePaise), cgst: big(s.cgstPaise), sgst: big(s.sgstPaise), roundOff: big(s.roundOffPaise), total: big(s.totalPaise) },
    payments: s.payments.map((p) => ({ mode: p.mode, amount: big(p.amountPaise), ref: p.ref })),
    idempotencyKey: s.idempotencyKey,
  };
}
export type Invoice = NonNullable<Awaited<ReturnType<typeof invoiceData>>>;

/** Medicines matching a search, with this branch's batches (blocked ones included, flagged). */
export async function searchForSale(ctx: Ctx, q: string) {
  const term = q.trim();
  if (!term) return [];
  const exact = /^\d{6,}$/.test(term) ? await db.medicine.findMany({ where: { tenantId: ctx.tenantId, active: true, barcode: term } }) : [];
  const meds = exact.length ? exact : await db.medicine.findMany({
    where: { tenantId: ctx.tenantId, active: true, OR: [{ name: { contains: term, mode: "insensitive" } }, { generic: { contains: term, mode: "insensitive" } }] },
    orderBy: { name: "asc" }, take: 7,
  });
  const batches = await db.batch.findMany({ where: { tenantId: ctx.tenantId, branchId: ctx.branchId, medicineId: { in: meds.map((m) => m.id) }, qtyAvailable: { gt: 0 } }, orderBy: [{ expiryDate: "asc" }, { batchNo: "asc" }] });
  return meds.map((m) => ({
    id: m.id, name: m.name, generic: m.generic, strength: m.strength, manufacturer: m.manufacturer, pack: m.pack, gstRate: m.gstRate, schedule: m.schedule, reorderLevel: m.reorderLevel, barcodeHit: exact.length > 0,
    batches: batches.filter((b) => b.medicineId === m.id).map((b) => ({ id: b.id, medicineId: m.id, batchNo: b.batchNo, expiryDate: b.expiryDate.toISOString().slice(0, 10), qtyAvailable: b.qtyAvailable, status: b.status as string, mrp: big(b.mrpPaise), cost: big(b.costPaise) })),
  }));
}
export type SaleMedicine = Awaited<ReturnType<typeof searchForSale>>[number];

export async function posCustomers(ctx: Ctx) {
  const cs = await db.customer.findMany({ where: { tenantId: ctx.tenantId, erasedAt: null }, orderBy: { name: "asc" }, take: 500 });
  const { customerBalances } = await import("@/domain/parties/balances");
  const bal = await customerBalances(db, ctx.tenantId);
  return cs.map((c) => ({ id: c.id, name: c.name, phone: c.phone, optIn: c.waOptIn, limit: big(c.creditLimitPaise), due: bal.get(c.id) ?? 0 }));
}

export async function createCustomer(ctx: Ctx, raw: CustomerInput) {
  authorize(ctx, "sale");
  const i = customerSchema.parse(raw);
  if (i.creditLimit > 0 && !can(ctx, "credit")) throw new UserError("Your role cannot set a credit limit.");
  if (i.waOptIn && !i.phone) throw new UserError("WhatsApp opt-in needs a mobile number.");
  return db.$transaction(async (tx) => {
    if (i.phone && (await tx.customer.findFirst({ where: { tenantId: ctx.tenantId, phone: i.phone } }))) throw new UserError("A customer with this mobile number already exists.");
    const c = await tx.customer.create({ data: { tenantId: ctx.tenantId, name: i.name, phone: i.phone || null, waOptIn: i.waOptIn, optInAt: i.waOptIn ? new Date() : null, optInMethod: i.waOptIn ? `Counter, recorded by ${ctx.userName}` : null, creditLimitPaise: BigInt(i.creditLimit) } });
    await writeAudit(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: "Customer added", entity: "customer", entityId: c.id, detail: `${c.name}${c.waOptIn ? " · WhatsApp opt-in" : ""}` });
    return c.id;
  });
}

// ── Held carts (per branch, survive reloads and are visible to other counters).
export const listHeld = (ctx: Ctx) => db.heldCart.findMany({ where: { tenantId: ctx.tenantId, branchId: ctx.branchId }, orderBy: { createdAt: "asc" } });

export async function holdCart(ctx: Ctx, label: string, cart: unknown) {
  authorize(ctx, "sale");
  if (JSON.stringify(cart).length > 50_000) throw new UserError("Cart too large to hold.");
  if ((await db.heldCart.count({ where: { tenantId: ctx.tenantId, branchId: ctx.branchId } })) >= 20) throw new UserError("20 carts are already on hold. Recall or clear some first.");
  await db.heldCart.create({ data: { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, label: label.slice(0, 120), cart: cart as object } });
}

export async function takeHeld(ctx: Ctx, id: string) {
  authorize(ctx, "sale");
  const rows = await db.heldCart.deleteMany({ where: { id, tenantId: ctx.tenantId, branchId: ctx.branchId } });
  if (!rows.count) throw new UserError("That held cart was already recalled.");
}

export async function heldCart(ctx: Ctx, id: string) {
  return db.heldCart.findFirst({ where: { id, tenantId: ctx.tenantId, branchId: ctx.branchId } });
}
