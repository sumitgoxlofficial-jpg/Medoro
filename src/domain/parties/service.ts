import "server-only";
import { db, type Tx } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorize, authorizeAny, can, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { addDays, dateOnly, daysTo, todayISO } from "@/lib/dates";
import { big, inr } from "@/lib/money";
import { postVoucher } from "@/domain/accounting/post";
import { ACC } from "@/domain/accounting/accounts";
import { supplierPerformance } from "@/domain/purchasing/service";
import { customerSchema, type CustomerInput } from "@/domain/sales/contracts";
import { allocateToBills, customerBalance, customerBalances, supplierBalances } from "./balances";
import { paymentSchema, supplierSchema, type PaymentInput, type SupplierInput } from "./contracts";
import { pointsBalances } from "@/domain/sales/loyalty";

export async function listSuppliers(ctx: Ctx) {
  const [rows, bal, bills, perf] = await Promise.all([
    db.supplier.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { name: "asc" } }),
    supplierBalances(db, ctx.tenantId),
    db.supplierBill.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { dueDate: "asc" } }),
    supplierPerformance(db, ctx.tenantId),
  ]);
  return rows.map((s) => {
    const open = bills.find((b) => b.supplierId === s.id && b.paidPaise < b.amountPaise);
    const p = perf.get(s.id);
    return {
      id: s.id, name: s.name, gstin: s.gstin, phone: s.phone, creditDays: s.creditDays, leadDays: Number(s.leadDays), acceptsReturns: s.acceptsReturns, stateCode: s.stateCode ?? "",
      accuracy: p ? p.fillPct : null, onTime: p ? p.onTimePct : null, orders: p?.orders ?? 0, balance: bal.get(s.id) ?? 0, version: s.version,
      nextDue: open ? { date: open.dueDate.toISOString().slice(0, 10), days: daysTo(open.dueDate), amount: big(open.amountPaise) - big(open.paidPaise) } : null,
    };
  });
}

export async function listCustomers(ctx: Ctx) {
  const [rows, bal, last, pts] = await Promise.all([
    db.customer.findMany({ where: { tenantId: ctx.tenantId, erasedAt: null }, orderBy: { name: "asc" } }),
    customerBalances(db, ctx.tenantId),
    db.sale.groupBy({ by: ["customerId"], where: { tenantId: ctx.tenantId, customerId: { not: null } }, _max: { at: true } }),
    pointsBalances(db, ctx.tenantId),
  ]);
  return rows.map((c) => ({
    id: c.id, name: c.name, phone: c.phone, optIn: c.waOptIn, optInAt: c.optInAt?.toISOString() ?? null, smsOptIn: c.smsOptIn, waInvalid: c.waInvalidReason ?? (c.waInvalidAt ? "Not on WhatsApp" : null), limit: big(c.creditLimitPaise),
    due: bal.get(c.id) ?? 0, points: pts.get(c.id) ?? 0, lastVisit: last.find((l) => l.customerId === c.id)?._max.at?.toISOString() ?? null, version: c.version,
  }));
}

export async function saveSupplier(ctx: Ctx, id: string | null, raw: SupplierInput) {
  return db.$transaction((tx) => saveSupplierIn(tx, ctx, id, raw));
}

export async function saveSupplierIn(tx: Tx, ctx: Ctx, id: string | null, raw: SupplierInput) {
  authorizeAny(ctx, "purchase", "payments");
  const i = supplierSchema.parse(raw);
  const dup = await tx.supplier.findFirst({ where: { tenantId: ctx.tenantId, name: { equals: i.name, mode: "insensitive" }, ...(id ? { NOT: { id } } : {}) } });
  if (dup) throw new UserError(`${dup.name} already exists.`);
  const data = { name: i.name, gstin: i.gstin || null, phone: i.phone || null, creditDays: i.creditDays, leadDays: i.leadDays, acceptsReturns: i.acceptsReturns, stateCode: i.stateCode || null };
  if (id) {
    const r = await tx.supplier.updateMany({ where: { id, tenantId: ctx.tenantId }, data: { ...data, version: { increment: 1 } } });
    if (!r.count) throw new UserError("Supplier not found.");
    await writeAudit(tx, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Supplier updated", entity: "supplier", entityId: id, detail: i.name });
    return id;
  }
  const s = await tx.supplier.create({ data: { tenantId: ctx.tenantId, ...data } });
  if (i.opening > 0) {
    authorize(ctx, "payments");
    await postVoucher(tx, { tenantId: ctx.tenantId, type: "journal", userId: ctx.userId, refType: "opening", refId: s.id, narration: `Opening balance · ${s.name}`,
      lines: [{ account: ACC.opening, dr: i.opening }, { account: ACC.creditors, cr: i.opening, partyType: "supplier", partyId: s.id }] });
    await tx.supplierBill.create({ data: { tenantId: ctx.tenantId, supplierId: s.id, ref: "Opening balance", date: dateOnly(todayISO()), dueDate: dateOnly(addDays(todayISO(), i.creditDays)), amountPaise: BigInt(i.opening) } });
  }
  await writeAudit(tx, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Supplier added", entity: "supplier", entityId: s.id, detail: `${s.name}${i.opening ? " · opening " + inr(i.opening) : ""}` });
  return s.id;
}

export async function saveCustomer(ctx: Ctx, id: string | null, raw: CustomerInput & { opening?: string | number }) {
  return db.$transaction((tx) => saveCustomerIn(tx, ctx, id, raw));
}

export async function saveCustomerIn(tx: Tx, ctx: Ctx, id: string | null, raw: CustomerInput & { opening?: string | number }) {
  authorize(ctx, "sale");
  const i = customerSchema.parse(raw);
  const opening = Math.round((parseFloat(String(raw.opening ?? 0)) || 0) * 100);
  if (i.phone && (await tx.customer.findFirst({ where: { tenantId: ctx.tenantId, phone: i.phone, ...(id ? { NOT: { id } } : {}) } }))) throw new UserError("Another customer has this mobile number.");
  const before = id ? await tx.customer.findFirst({ where: { id, tenantId: ctx.tenantId, erasedAt: null } }) : null;
  if (id && !before) throw new UserError("Customer not found.");
  if (big(before?.creditLimitPaise) !== i.creditLimit && !can(ctx, "credit")) throw new UserError("Your role cannot change credit limits.");
  if (i.waOptIn && !i.phone) throw new UserError("WhatsApp opt-in needs a mobile number.");
  if (i.smsOptIn && !i.phone) throw new UserError("SMS consent needs a mobile number.");
  const consentChanged = !before || before.waOptIn !== i.waOptIn;
  const consent = consentChanged ? { optInAt: i.waOptIn ? new Date() : null, optInMethod: i.waOptIn ? `Recorded by ${ctx.userName}` : `Opted out, recorded by ${ctx.userName}` } : {};
  const smsChanged = !before ? i.smsOptIn : before.smsOptIn !== i.smsOptIn;
  const smsConsent = smsChanged ? { smsOptInAt: new Date(), smsOptInMethod: i.smsOptIn ? `Recorded by ${ctx.userName}` : `Opted out, recorded by ${ctx.userName}` } : {};
  // A new number, or WhatsApp consent recorded again, clears an earlier "not on WhatsApp" report.
  const recheck = before?.waInvalidAt && ((i.phone || null) !== before.phone || (i.waOptIn && !before.waOptIn)) ? { waInvalidAt: null, waInvalidReason: null } : {};
  const data = { name: i.name, phone: i.phone || null, waOptIn: i.waOptIn, smsOptIn: i.smsOptIn, creditLimitPaise: BigInt(i.creditLimit), ...consent, ...smsConsent, ...recheck };
  let cid = id;
  if (id) await tx.customer.update({ where: { id }, data: { ...data, version: { increment: 1 } } });
  else cid = (await tx.customer.create({ data: { tenantId: ctx.tenantId, ...data } })).id;
  if (!id && opening > 0) {
    authorize(ctx, "payments");
    await postVoucher(tx, { tenantId: ctx.tenantId, type: "journal", userId: ctx.userId, refType: "opening", refId: cid!, narration: `Opening balance · ${i.name}`,
      lines: [{ account: ACC.debtors, dr: opening, partyType: "customer", partyId: cid! }, { account: ACC.opening, cr: opening }] });
  }
  await writeAudit(tx, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: id ? "Customer updated" : "Customer added", entity: "customer", entityId: cid,
    detail: `${i.name}${consentChanged && id ? (i.waOptIn ? " · WhatsApp opt-in" : " · WhatsApp opt-out") : ""}${smsChanged ? (i.smsOptIn ? " · SMS opt-in" : " · SMS opt-out") : ""}${before && big(before.creditLimitPaise) !== i.creditLimit ? ` · limit ${inr(big(before.creditLimitPaise))} → ${inr(i.creditLimit)}` : ""}` });
  return cid!;
}

const moneyAccount = (method: string) => (method === "Cash" ? ACC.cash : ACC.bank);

/** Pays a supplier and allocates the amount to their oldest open bills. */
export async function paySupplier(ctx: Ctx, raw: PaymentInput) {
  authorize(ctx, "payments");
  const i = paymentSchema.parse(raw);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"party:" + i.partyId}))`;
    const s = await tx.supplier.findFirst({ where: { id: i.partyId, tenantId: ctx.tenantId } });
    if (!s) throw new UserError("Supplier not found.");
    const bal = (await supplierBalances(tx, ctx.tenantId)).get(s.id) ?? 0;
    if (i.amount > bal) throw new UserError(`Amount exceeds the outstanding balance ${inr(bal)}.`);
    const v = await postVoucher(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, type: "payment", userId: ctx.userId, refType: "supplier_payment", refId: s.id,
      narration: `Payment to ${s.name} · ${i.method}${i.ref ? " · " + i.ref : ""}`,
      lines: [{ account: ACC.creditors, dr: i.amount, partyType: "supplier", partyId: s.id }, { account: moneyAccount(i.method), cr: i.amount }] });
    await allocateToBills(tx, ctx.tenantId, s.id, i.amount);
    await writeAudit(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: `Voucher posted ${v.no}`, entity: "voucher", entityId: v.id, detail: `Payment to ${s.name} · ${inr(i.amount)} · ${i.method}` });
    return v.no;
  });
}

export async function receiveFromCustomer(ctx: Ctx, raw: PaymentInput) {
  authorize(ctx, "payments");
  const i = paymentSchema.parse(raw);
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"party:" + i.partyId}))`;
    const c = await tx.customer.findFirst({ where: { id: i.partyId, tenantId: ctx.tenantId } });
    if (!c) throw new UserError("Customer not found.");
    const due = await customerBalance(tx, ctx.tenantId, c.id);
    if (i.amount > due) throw new UserError(`Amount exceeds the outstanding balance ${inr(due)}.`);
    const v = await postVoucher(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, type: "receipt", userId: ctx.userId, refType: "customer_receipt", refId: c.id,
      narration: `Receipt from ${c.name} · ${i.method}${i.ref ? " · " + i.ref : ""}`,
      lines: [{ account: moneyAccount(i.method), dr: i.amount }, { account: ACC.debtors, cr: i.amount, partyType: "customer", partyId: c.id }] });
    await writeAudit(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: `Voucher posted ${v.no}`, entity: "voucher", entityId: v.id, detail: `Receipt from ${c.name} · ${inr(i.amount)} · ${i.method}` });
    return v.no;
  });
}
