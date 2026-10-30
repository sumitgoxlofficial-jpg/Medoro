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
import { isMasked } from "@/lib/mask";
import { phoneMasker } from "@/domain/system/strict";
import { allocateToBills, customerBalance, customerBalances, supplierBalances } from "./balances";
import { applyConsents, consentHistory, type ConsentInput } from "./consent";
import { paymentSchema, supplierSchema, type PaymentInput, type SupplierInput } from "./contracts";
import { chequeLabel, recordCheque } from "./cheques";

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
      id: s.id, name: s.name, gstin: s.gstin, phone: s.phone, creditDays: s.creditDays, leadDays: Number(s.leadDays), acceptsReturns: s.acceptsReturns, stateCode: s.stateCode ?? "", returnWindowDays: s.returnWindowDays,
      accuracy: p ? p.fillPct : null, onTime: p ? p.onTimePct : null, orders: p?.orders ?? 0, balance: bal.get(s.id) ?? 0, version: s.version,
      nextDue: open ? { date: open.dueDate.toISOString().slice(0, 10), days: daysTo(open.dueDate), amount: big(open.amountPaise) - big(open.paidPaise) } : null,
    };
  });
}

export async function listCustomers(ctx: Ctx) {
  const [rows, bal, last, mask] = await Promise.all([
    db.customer.findMany({ where: { tenantId: ctx.tenantId, erasedAt: null }, orderBy: { name: "asc" } }),
    customerBalances(db, ctx.tenantId),
    db.sale.groupBy({ by: ["customerId"], where: { tenantId: ctx.tenantId, customerId: { not: null } }, _max: { at: true } }),
    phoneMasker(ctx),
  ]);
  return rows.map((c) => ({
    id: c.id, name: c.name, phone: mask(c.phone), optIn: c.waOptIn, smsOptIn: c.smsOptIn, marketingWa: c.marketingWa, marketingSms: c.marketingSms,
    optInAt: c.optInAt?.toISOString() ?? null, limit: big(c.creditLimitPaise),
    gstin: c.gstin, stateCode: c.stateCode ?? "", address: c.address ?? "", pincode: c.pincode ?? "",
    due: bal.get(c.id) ?? 0, lastVisit: last.find((l) => l.customerId === c.id)?._max.at?.toISOString() ?? null, version: c.version,
  }));
}

/** Consent records for one customer, newest first: purpose, channel, given or withdrawn, how, where, by whom and when. */
export async function customerConsents(ctx: Ctx, customerId: string) {
  if (!can(ctx, "sale")) throw new UserError("Your role cannot view customers.");
  return consentHistory(db, ctx.tenantId, customerId);
}

export async function saveSupplier(ctx: Ctx, id: string | null, raw: SupplierInput, version?: number) {
  return db.$transaction((tx) => saveSupplierIn(tx, ctx, id, raw, version));
}

export async function saveSupplierIn(tx: Tx, ctx: Ctx, id: string | null, raw: SupplierInput, version?: number) {
  authorizeAny(ctx, "purchase", "payments");
  const i = supplierSchema.parse(raw);
  const dup = await tx.supplier.findFirst({ where: { tenantId: ctx.tenantId, name: { equals: i.name, mode: "insensitive" }, ...(id ? { NOT: { id } } : {}) } });
  if (dup) throw new UserError(`${dup.name} already exists.`);
  const data = { name: i.name, gstin: i.gstin || null, phone: i.phone || null, creditDays: i.creditDays, leadDays: i.leadDays, acceptsReturns: i.acceptsReturns, stateCode: i.stateCode || null, returnWindowDays: i.returnWindowDays };
  if (id) {
    const r = await tx.supplier.updateMany({ where: { id, tenantId: ctx.tenantId, ...(version === undefined ? {} : { version }) }, data: { ...data, version: { increment: 1 } } });
    if (!r.count) throw new UserError((await tx.supplier.count({ where: { id, tenantId: ctx.tenantId } })) ? "Someone else changed this supplier. Reopen it and try again." : "Supplier not found.");
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

export async function saveCustomer(ctx: Ctx, id: string | null, raw: CustomerInput & ConsentInput & { opening?: string | number }, version?: number) {
  return db.$transaction((tx) => saveCustomerIn(tx, ctx, id, raw, "parties", version));
}

export async function saveCustomerIn(tx: Tx, ctx: Ctx, id: string | null, raw: CustomerInput & ConsentInput & { opening?: string | number }, source = "parties", version?: number) {
  authorize(ctx, "sale");
  // A masked number (strict mode, staff below manager) means "unchanged".
  const keep = id && isMasked(raw.phone) ? await tx.customer.findFirst({ where: { id, tenantId: ctx.tenantId }, select: { phone: true } }) : null;
  const i = customerSchema.parse(keep ? { ...raw, phone: keep.phone ?? "" } : raw);
  const opening = Math.round((parseFloat(String(raw.opening ?? 0)) || 0) * 100);
  if (i.phone && (await tx.customer.findFirst({ where: { tenantId: ctx.tenantId, phone: i.phone, ...(id ? { NOT: { id } } : {}) } }))) throw new UserError("Another customer has this mobile number.");
  const before = id ? await tx.customer.findFirst({ where: { id, tenantId: ctx.tenantId, erasedAt: null } }) : null;
  if (id && !before) throw new UserError("Customer not found.");
  if (big(before?.creditLimitPaise) !== i.creditLimit && !can(ctx, "credit")) throw new UserError("Your role cannot change credit limits.");
  if (i.waOptIn && !i.phone) throw new UserError("WhatsApp opt-in needs a mobile number.");
  const consentChanged = !before || before.waOptIn !== i.waOptIn;
  const consent = consentChanged ? { optInAt: i.waOptIn ? new Date() : null, optInMethod: i.waOptIn ? `Recorded by ${ctx.userName}` : `Opted out, recorded by ${ctx.userName}` } : {};
  const data = { name: i.name, phone: i.phone || null, waOptIn: i.waOptIn, creditLimitPaise: BigInt(i.creditLimit), gstin: i.gstin || null, stateCode: i.stateCode || null, address: i.address || null, pincode: i.pincode || null, ...consent };
  let saved;
  if (id) {
    const r = await tx.customer.updateMany({ where: { id, tenantId: ctx.tenantId, erasedAt: null, ...(version === undefined ? {} : { version }) }, data: { ...data, version: { increment: 1 } } });
    if (!r.count) throw new UserError("Someone else changed this customer. Reopen it and try again.");
    saved = await tx.customer.findFirstOrThrow({ where: { id, tenantId: ctx.tenantId } });
  } else saved = await tx.customer.create({ data: { tenantId: ctx.tenantId, ...data } });
  const cid = saved.id;
  const consents = await applyConsents(tx, ctx, saved, before, { ...raw, waOptIn: i.waOptIn }, source);
  if (!id && opening > 0) {
    authorize(ctx, "payments");
    await postVoucher(tx, { tenantId: ctx.tenantId, type: "journal", userId: ctx.userId, refType: "opening", refId: cid, narration: `Opening balance · ${i.name}`,
      lines: [{ account: ACC.debtors, dr: opening, partyType: "customer", partyId: cid }, { account: ACC.opening, cr: opening }] });
  }
  await writeAudit(tx, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: id ? "Customer updated" : "Customer added", entity: "customer", entityId: cid,
    detail: `${i.name}${i.gstin ? " · GSTIN " + i.gstin : ""}${consents.length ? " · consent " + consents.join(", ") : ""}${before && big(before.creditLimitPaise) !== i.creditLimit ? ` · limit ${inr(big(before.creditLimitPaise))} → ${inr(i.creditLimit)}` : ""}` });
  return cid;
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
    const chq = i.method === "Cheque";
    const v = await postVoucher(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, type: "payment", userId: ctx.userId, refType: chq ? "cheque_payment" : "supplier_payment", refId: s.id,
      narration: `Payment to ${s.name} · ${chq ? chequeLabel(i) : i.method}${i.ref ? " · " + i.ref : ""}`,
      lines: [{ account: ACC.creditors, dr: i.amount, partyType: "supplier", partyId: s.id }, { account: chq ? ACC.chequesIssued : moneyAccount(i.method), cr: i.amount }] });
    if (chq) await recordCheque(tx, ctx, { direction: "issued", partyType: "supplier", partyId: s.id, input: i, voucherId: v.id });
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
    const chq = i.method === "Cheque";
    const v = await postVoucher(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, type: "receipt", userId: ctx.userId, refType: chq ? "cheque_receipt" : "customer_receipt", refId: c.id,
      narration: `Receipt from ${c.name} · ${chq ? chequeLabel(i) : i.method}${i.ref ? " · " + i.ref : ""}`,
      lines: [{ account: chq ? ACC.chequesInHand : moneyAccount(i.method), dr: i.amount }, { account: ACC.debtors, cr: i.amount, partyType: "customer", partyId: c.id }] });
    if (chq) await recordCheque(tx, ctx, { direction: "received", partyType: "customer", partyId: c.id, input: i, voucherId: v.id });
    await writeAudit(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: `Voucher posted ${v.no}`, entity: "voucher", entityId: v.id, detail: `Receipt from ${c.name} · ${inr(i.amount)} · ${i.method}` });
    return v.no;
  });
}
