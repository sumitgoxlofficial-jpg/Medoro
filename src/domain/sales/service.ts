import "server-only";
import { Prisma } from "@prisma/client";
import { db, type DbOrTx, type Tx } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorize, can, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { nextSeq } from "@/server/sequence";
import { invoiceNo as makeInvoiceNo, validSeries } from "@/lib/docno";
import { isH1 } from "@/lib/rx";
import { phoneMasker } from "@/domain/system/strict";
import { daysTo, fiscalYear, todayISO } from "@/lib/dates";
import { big, cartTotals, inr, inr0 } from "@/lib/money";
import { discountCap } from "@/domain/identity/permissions";
import { postVoucher, type Line } from "@/domain/accounting/post";
import { ACC } from "@/domain/accounting/accounts";
import { customerBalance } from "@/domain/parties/balances";
import { applyConsents, type ConsentInput } from "@/domain/parties/consent";
import { invoiceGrievance } from "@/domain/system/privacy";
import { saleTaxSplit } from "@/domain/gst/tax";
import { lockOpenShift } from "./returns";
import { saleSchema, customerSchema, type SaleInput, type CustomerInput } from "./contracts";
import { consumeApproval, maxDiscount } from "./approval";
import { baseQty, canSellLoose, fmtQty, fmtSold, unitCost, unitPrice } from "@/lib/units";
import { branchRacks, rankSubstitutes, searchCatalog } from "@/domain/inventory/catalog";

export const OFFLINE_MAX_DAYS = 7;
export const withinOfflineWindow = (at: Date, now = Date.now()) =>
  !Number.isNaN(at.getTime()) && at.getTime() <= now + 5 * 60_000 && at.getTime() >= now - OFFLINE_MAX_DAYS * 86_400_000;
export type CommitResult = { saleId: string; invoiceNo: string; total: number; replayed: boolean };
export type DeviceQuota = { at?: string; batches?: Record<string, number>; users?: string[] };

/**
 * Units of each batch held back for offline devices in the branch (other than `except`). A device's
 * share lapses with its snapshot, after the offline window.
 */
export async function reservedForDevices(q: DbOrTx, tenantId: string, branchId: string, except?: string) {
  const devs = await q.device.findMany({ where: { tenantId, branchId, offline: true, ...(except ? { id: { not: except } } : {}) }, select: { quota: true } });
  const m = new Map<string, number>();
  for (const d of devs) {
    const qu = d.quota as DeviceQuota;
    if (!qu.at || !withinOfflineWindow(new Date(qu.at))) continue;
    for (const [b, n] of Object.entries(qu.batches ?? {})) if (n > 0) m.set(b, (m.get(b) ?? 0) + n);
  }
  return m;
}

/**
 * Commits a sale atomically. Everything the client sends is re-validated here:
 * stock (row-locked), batch eligibility, prices from the database, discount cap,
 * prescription rule, credit permission and limit. Same idempotency key → same sale.
 */
export async function commitSale(ctx: Ctx, raw: SaleInput, opts: { at?: Date; note?: string; deviceId?: string; cod?: boolean } = {}): Promise<CommitResult> {
  authorize(ctx, "sale");
  const input = saleSchema.parse(raw);
  // Offline sales keep the time they were billed; bounded so a wrong device clock can't backdate books.
  const at = opts.at;
  if (at && !withinOfflineWindow(at)) {
    throw new UserError(`The bill time must be within the last ${OFFLINE_MAX_DAYS} days.`);
  }
  const existing = await replayOf(ctx.tenantId, input);
  if (existing) return existing;
  if (input.pay.mode === "cod" && !opts.cod) throw new UserError("Cash on delivery is billed from Orders when the order is packed.");
  try {
    return await db.$transaction((tx) => commitTx(tx, ctx, input, at, opts.note, opts.deviceId), { timeout: 15000 });
  } catch (e) {
    // A concurrent request with the same key won the race: return its result.
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const s = await replayOf(ctx.tenantId, input);
      if (s) return s;
    }
    throw e;
  }
}

const lineSig = (ls: { batchId: string; qty: number }[]) =>
  Object.entries(ls.reduce<Record<string, number>>((m, l) => ({ ...m, [l.batchId]: (m[l.batchId] ?? 0) + l.qty }), {})).sort().join(";");

/** The sale already saved under this key, if any. A key reused for a different cart is refused, never replayed. */
async function replayOf(tenantId: string, input: SaleInput): Promise<CommitResult | null> {
  const s = await db.sale.findUnique({ where: { tenantId_idempotencyKey: { tenantId, idempotencyKey: input.idempotencyKey } }, include: { items: true } });
  if (!s) return null;
  const same = lineSig(s.items) === lineSig(input.lines) && Number(s.discountPct) === input.discountPct && (s.customerId ?? null) === (input.customerId ?? null) && s.payMode === input.pay.mode;
  if (!same) throw new UserError(`This bill’s key was already used for ${s.invoiceNo}, which has different items or payment. Start a new bill.`);
  return { saleId: s.id, invoiceNo: s.invoiceNo, total: big(s.totalPaise), replayed: true };
}

async function commitTx(tx: Tx, ctx: Ctx, input: SaleInput, at?: Date, note?: string, deviceId?: string): Promise<CommitResult> {
  const today = todayISO(at);
  const ids = [...new Set(input.lines.map((l) => l.batchId))];
  // Lock the batches so two counters can't sell the same last unit.
  await tx.$queryRaw`SELECT id FROM "Batch" WHERE id IN (${Prisma.join(ids)}) AND "tenantId" = ${ctx.tenantId} ORDER BY id FOR UPDATE`;
  const batches = await tx.batch.findMany({ where: { id: { in: ids }, tenantId: ctx.tenantId }, include: { medicine: true } });
  const byId = new Map(batches.map((b) => [b.id, b]));
  // Batches hold stock units: a pack takes packSize units, a loose unit takes one.
  const need = new Map<string, number>();
  for (const l of input.lines) {
    const b = byId.get(l.batchId);
    if (!b || b.branchId !== ctx.branchId || b.medicineId !== l.medicineId) throw new UserError("A cart line doesn’t match this branch’s stock. Review the cart.");
    if (l.unit === "loose" && !canSellLoose(b.medicine)) throw new UserError(`${b.medicine.name} isn’t sold loose. Sell whole ${b.medicine.packUnit}s.`);
    need.set(b.id, (need.get(b.id) ?? 0) + baseQty(l.qty, l.unit, b.medicine.packSize));
  }
  // Stock reserved for offline counters isn't sellable here; a device's own bills may use its share.
  const reserved = await reservedForDevices(tx, ctx.tenantId, ctx.branchId, deviceId);
  for (const [id, q] of need) {
    const b = byId.get(id)!;
    if (b.status !== "ok") throw new UserError(`${b.medicine.name} batch ${b.batchNo} is ${b.status === "quarantine" ? "quarantined" : b.status} and blocked from sale.`);
    if (daysTo(b.expiryDate, today) <= 0) throw new UserError(`${b.medicine.name} batch ${b.batchNo} has expired and is blocked from sale.`);
    const held = Math.min(reserved.get(id) ?? 0, b.qtyAvailable);
    if (b.qtyAvailable - held < q) throw new UserError(`Stock changed on another device: only ${fmtQty(b.qtyAvailable - held, b.medicine)} of ${b.medicine.name} (${b.batchNo}) left${held ? ` (${fmtQty(held, b.medicine)} more kept for offline counters)` : ""}. Review the cart.`);
  }

  const cap = discountCap(ctx.perms);
  const ceiling = await maxDiscount(ctx.tenantId, tx);
  if (input.discountPct > ceiling) throw new UserError(`Discounts above ${ceiling}% aren’t allowed.`);
  if (input.discountPct > cap && !input.approval) throw new UserError(`Discount above ${cap}% needs manager approval.`);
  const rx = input.lines.some((l) => byId.get(l.batchId)!.medicine.schedule);
  const doctor = input.doctorId ? await tx.doctor.findFirst({ where: { id: input.doctorId, tenantId: ctx.tenantId } }) : null;
  if (input.doctorId && !doctor) throw new UserError("Doctor not found. Pick the doctor again.");
  const prescriber = input.prescriber?.trim() || (doctor ? `Dr ${doctor.name}${doctor.regNo ? ` (Reg ${doctor.regNo})` : ""}` : "");
  if (rx && !prescriber) throw new UserError("Enter the prescriber’s name for Schedule H/H1 items.");
  const customer = input.customerId ? await tx.customer.findFirst({ where: { id: input.customerId, tenantId: ctx.tenantId, erasedAt: null } }) : null;
  if (input.customerId && !customer) throw new UserError("Customer not found.");
  // Schedule H1, X and NDPS sales go in the register with patient, prescriber and registration number.
  const h1 = input.lines.some((l) => isH1(byId.get(l.batchId)!.medicine.schedule));
  const patientName = input.patientName?.trim() || (h1 ? customer?.name ?? "" : "");
  const prescriberReg = input.prescriberReg?.trim() || doctor?.regNo?.trim() || "";
  if (h1 && (!patientName || !prescriberReg)) throw new UserError(`Schedule H1, X and NDPS items need the ${[!patientName && "patient’s name", !prescriberReg && "prescriber’s registration no."].filter(Boolean).join(" and ")} for the register.`);

  // A loose unit sells at MRP ÷ pack size rounded down, so a full strip sold loose never exceeds the printed MRP.
  const lines = input.lines.map((l) => {
    const b = byId.get(l.batchId)!, loose = l.unit === "loose", ps = b.medicine.packSize;
    return { b, qty: l.qty, loose, ps, base: baseQty(l.qty, l.unit, ps), mrp: unitPrice(big(b.mrpPaise), l.unit, ps), cost: unitCost(big(b.costPaise), l.unit, ps) };
  });
  const t = cartTotals(lines.map(({ mrp, qty, b, cost }) => ({ mrpPaise: mrp, qty, gstRate: b.medicine.gstRate, costPaise: cost })), input.discountPct);
  if (t.total <= 0) throw new UserError("The bill total must be more than zero.");
  const approval = input.discountPct > cap ? await consumeApproval(tx, ctx, input.approval!, input.lines, input.discountPct, t.total) : null;

  const pay = { cash: 0, upi: 0, card: 0, credit: 0, cod: 0 };
  const m = input.pay.mode;
  if (m === "split") {
    const cash = input.pay.cashPaise ?? -1;
    if (cash <= 0 || cash >= t.total) throw new UserError("Enter a cash part between ₹1 and the bill total.");
    pay.cash = cash; pay.upi = t.total - cash;
  } else if (m === "credit") {
    if (!can(ctx, "credit")) throw new UserError("Your role cannot make credit sales.");
    if (!customer) throw new UserError("Select a customer for a credit sale.");
    // Serialise credit sales per customer so two counters can't both fit under the limit.
    await tx.$queryRaw`SELECT id FROM "Customer" WHERE id = ${customer.id} AND "tenantId" = ${ctx.tenantId} FOR UPDATE`;
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
  if (!validSeries(branch.code)) throw new UserError(`Branch code ${branch.code} can’t number GST invoices (1–5 letters or digits). Contact support.`);
  const invoiceNo = makeInvoiceNo(branch.code, fy, n);
  const shift = await lockOpenShift(tx, ctx);
  const g = saleTaxSplit(branch.gstin ?? tenant.gstin, customer, t.tax);

  const sale = await tx.sale.create({
    data: {
      tenantId: ctx.tenantId, branchId: ctx.branchId, invoiceNo, idempotencyKey: input.idempotencyKey, customerId: customer?.id ?? null,
      prescriber: prescriber || null, rxNo: input.rxNo?.trim() || null, prescriberReg: prescriberReg || null, patientName: patientName || null, doctorId: doctor?.id ?? null,
      subtotalPaise: BigInt(t.mrpTotal), discountPaise: BigInt(t.discount), discountPct: new Prisma.Decimal(input.discountPct), taxablePaise: BigInt(t.taxable),
      cgstPaise: BigInt(g.cgst), sgstPaise: BigInt(g.sgst), igstPaise: BigInt(g.igst), placeOfSupply: g.pos, customerGstin: g.gstin, roundOffPaise: BigInt(t.roundOff), totalPaise: BigInt(t.total), costPaise: BigInt(t.cost),
      payMode: m, shiftId: shift?.id ?? null, userId: ctx.userId, ...(at ? { at } : {}),
      items: { create: lines.map(({ b, qty, mrp, cost, loose, ps }, i) => ({ batchId: b.id, medicineId: b.medicineId, qty, mrpPaise: BigInt(mrp), discountPaise: BigInt(t.lines[i].discount), taxablePaise: BigInt(t.lines[i].taxable), gstRate: b.medicine.gstRate, costPaise: BigInt(cost), loose, packSize: ps })) },
      payments: { create: (Object.entries(pay) as [keyof typeof pay, number][]).filter(([, a]) => a > 0).map(([mode, a]) => ({ mode, amountPaise: BigInt(a), ref: mode === "cash" ? null : input.pay.ref || null })) },
    },
  });
  if (approval) await tx.discountApproval.update({ where: { id: approval.id }, data: { saleId: sale.id } });
  for (const [id, q] of need) {
    const r = await tx.batch.updateMany({ where: { id, qtyAvailable: { gte: q } }, data: { qtyAvailable: { decrement: q }, version: { increment: 1 } } });
    if (!r.count) throw new UserError("Stock changed on another device. Review the cart.");
  }
  await tx.stockMovement.createMany({ data: lines.map(({ b, base }) => ({ tenantId: ctx.tenantId, branchId: ctx.branchId, batchId: b.id, qty: -base, type: "sale", refType: "sale", refId: sale.id, userId: ctx.userId, note: invoiceNo })) });
  if (deviceId) {
    // The device has now used this much of its reserved share.
    await tx.$queryRaw`SELECT id FROM "Device" WHERE id = ${deviceId} AND "tenantId" = ${ctx.tenantId} FOR UPDATE`;
    const dev = await tx.device.findFirst({ where: { id: deviceId, tenantId: ctx.tenantId } });
    const qu = (dev?.quota ?? {}) as DeviceQuota;
    if (dev && qu.batches) {
      const batchesLeft = { ...qu.batches };
      for (const [id, q] of need) if (batchesLeft[id]) batchesLeft[id] = Math.max(0, batchesLeft[id] - q);
      await tx.device.update({ where: { id: dev.id }, data: { quota: { ...qu, batches: batchesLeft } } });
    }
  }

  const vl: Line[] = [
    { account: ACC.cash, dr: pay.cash }, { account: ACC.bank, dr: pay.upi + pay.card },
    // Billed at packing, collected at the door: held against the delivery staff until handed over.
    { account: ACC.codClearing, dr: pay.cod },
    ...(pay.credit ? [{ account: ACC.debtors, dr: pay.credit, partyType: "customer" as const, partyId: customer!.id }] : []),
    { account: ACC.sales, cr: t.taxable }, { account: ACC.cgst, cr: g.cgst }, { account: ACC.sgst, cr: g.sgst }, { account: ACC.igst, cr: g.igst },
    t.roundOff >= 0 ? { account: ACC.roundOff, cr: t.roundOff } : { account: ACC.roundOff, dr: -t.roundOff },
  ];
  await postVoucher(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, type: "sales", narration: `Sale ${invoiceNo}${customer ? " · " + customer.name : ""}`, userId: ctx.userId, refType: "sale", refId: sale.id, date: at, lines: vl });
  await writeAudit(tx, {
    tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: "Sale committed", entity: "sale", entityId: sale.id,
    detail: `${invoiceNo} · ${inr(t.total)} · ${m.toUpperCase()}${input.discountPct ? ` · discount ${input.discountPct}%${approval ? ` approved by ${approval.by}` : ""}` : ""}${rx ? " · Rx" : ""}${doctor ? ` · Dr ${doctor.name}` : ""}${at ? " · billed offline" : ""}${note ? " · " + note : ""}`,
  });
  return { saleId: sale.id, invoiceNo, total: t.total, replayed: false };
}

/** Everything needed to print or show an invoice. */
export async function invoiceData(ctx: Ctx, saleId: string) {
  const s = await db.sale.findFirst({ where: { id: saleId, tenantId: ctx.tenantId }, include: { items: true, payments: true, customer: true, voided: true, doctor: true } });
  if (!s) return null;
  const [branch, tenant, meds, batches, user] = await Promise.all([
    db.branch.findUniqueOrThrow({ where: { id: s.branchId } }),
    db.tenant.findUniqueOrThrow({ where: { id: s.tenantId } }),
    db.medicine.findMany({ where: { id: { in: s.items.map((i) => i.medicineId) } } }),
    db.batch.findMany({ where: { id: { in: s.items.map((i) => i.batchId) } } }),
    db.user.findUnique({ where: { id: s.userId }, select: { name: true } }),
  ]);
  return {
    id: s.id, invoiceNo: s.invoiceNo, at: s.at.toISOString(), payMode: s.payMode, prescriber: s.prescriber, rxNo: s.rxNo, prescriberReg: s.prescriberReg, patientName: s.patientName, cashier: user?.name ?? "",
    doctor: s.doctor ? { id: s.doctor.id, name: s.doctor.name, qualification: s.doctor.qualification, regNo: s.doctor.regNo, clinic: s.doctor.clinic } : null,
    pharmacy: { name: tenant.name, legalName: tenant.legalName, gstin: branch.gstin ?? tenant.gstin, address: branch.address, dl: branch.drugLicence, phone: tenant.phone, pharmacist: (tenant.settings as { pharmacist?: string }).pharmacist ?? "", grievance: invoiceGrievance(tenant) as string | undefined },
    customer: s.customer ? { name: s.customer.name, phone: s.customer.phone, optIn: s.customer.waOptIn, gstin: s.customerGstin, address: [s.customer.address, s.customer.pincode].filter(Boolean).join(" ") || null } : null,
    placeOfSupply: s.placeOfSupply,
    lines: s.items.map((i) => {
      const m = meds.find((x) => x.id === i.medicineId)!, b = batches.find((x) => x.id === i.batchId)!;
      return { name: m.name, pack: i.loose ? `loose ${m.looseUnit}` : m.packSize > 1 ? `${m.packUnit} of ${m.packSize}` : m.pack, hsn: m.hsn, schedule: m.schedule, batchNo: b.batchNo, expiry: b.expiryDate.toISOString().slice(0, 10), qty: i.qty, qtyText: fmtSold(i.qty, i.loose ? "loose" : "pack", m), loose: i.loose, mrp: big(i.mrpPaise), amount: big(i.mrpPaise) * i.qty, discount: big(i.discountPaise), taxable: big(i.taxablePaise), gstRate: i.gstRate };
    }),
    totals: { mrp: big(s.subtotalPaise), discount: big(s.discountPaise), taxable: big(s.taxablePaise), cgst: big(s.cgstPaise), sgst: big(s.sgstPaise), igst: big(s.igstPaise), roundOff: big(s.roundOffPaise), total: big(s.totalPaise) },
    payments: s.payments.map((p) => ({ mode: p.mode, amount: big(p.amountPaise), ref: p.ref })),
    idempotencyKey: s.idempotencyKey,
    voided: s.voided ? { at: s.voided.at.toISOString(), reason: s.voided.reason } : null,
  };
}
export type Invoice = NonNullable<Awaited<ReturnType<typeof invoiceData>>>;

/** Medicines matching a search (brand, salt/composition, barcode or internal code), with this branch's batches (blocked ones included, flagged). */
export async function searchForSale(ctx: Ctx, q: string) {
  const { meds, barcodeHit } = await searchCatalog(ctx.tenantId, q, 7);
  return saleMedicines(ctx, meds, barcodeHit);
}

type MedRow = Awaited<ReturnType<typeof db.medicine.findMany>>[number];

async function saleMedicines(ctx: Ctx, meds: MedRow[], barcodeHit = false) {
  if (!meds.length) return [];
  // Stock reserved for offline counters isn't offered here (commitSale refuses it too).
  const [batches, racks, reserved] = await Promise.all([
    db.batch.findMany({ where: { tenantId: ctx.tenantId, branchId: ctx.branchId, medicineId: { in: meds.map((m) => m.id) }, qtyAvailable: { gt: 0 } }, orderBy: [{ expiryDate: "asc" }, { batchNo: "asc" }] }),
    branchRacks(ctx.tenantId, ctx.branchId),
    reservedForDevices(db, ctx.tenantId, ctx.branchId),
  ]);
  return meds.map((m) => ({
    id: m.id, name: m.name, generic: m.generic, strength: m.strength, manufacturer: m.manufacturer, pack: m.pack, gstRate: m.gstRate, schedule: m.schedule, reorderLevel: m.reorderLevel, barcodeHit,
    composition: m.composition, hasSalt: !!m.saltKey, rack: racks.get(m.id) ?? m.rack,
    packSize: m.packSize, packUnit: m.packUnit, looseUnit: m.looseUnit, allowLoose: canSellLoose(m),
    batches: batches.filter((b) => b.medicineId === m.id).map((b) => ({ id: b.id, medicineId: m.id, batchNo: b.batchNo, expiryDate: b.expiryDate.toISOString().slice(0, 10), qtyAvailable: Math.max(0, b.qtyAvailable - (reserved.get(b.id) ?? 0)), status: b.status as string, mrp: big(b.mrpPaise), cost: big(b.costPaise) })),
  }));
}
export type SaleMedicine = Awaited<ReturnType<typeof searchForSale>>[number];

/** Same-composition medicines for the counter, ready to add to the cart: in stock first, cheapest per unit (or best margin). */
export async function substitutesForSale(ctx: Ctx, medicineId: string, sort: "price" | "margin" = "price") {
  authorize(ctx, "sale");
  const m = await db.medicine.findFirst({ where: { id: medicineId, tenantId: ctx.tenantId } });
  if (!m) return { of: null, rows: [] };
  const of = { id: m.id, name: m.name, composition: m.composition ?? `${m.generic} ${m.strength}` };
  if (!m.saltKey) return { of, rows: [] };
  const alts = await db.medicine.findMany({ where: { tenantId: ctx.tenantId, active: true, saltKey: m.saltKey, NOT: { id: m.id } }, take: 40 });
  const ranked = await rankSubstitutes(ctx, alts, sort);
  const full = await saleMedicines(ctx, ranked.map((r) => alts.find((a) => a.id === r.id)!));
  return { of, rows: ranked.map((r) => ({ ...r, med: full.find((f) => f.id === r.id)! })) };
}

export async function posCustomers(ctx: Ctx) {
  const cs = await db.customer.findMany({ where: { tenantId: ctx.tenantId, erasedAt: null }, orderBy: { name: "asc" }, take: 500 });
  const { customerBalances } = await import("@/domain/parties/balances");
  const bal = await customerBalances(db, ctx.tenantId);
  const br = await db.branch.findUniqueOrThrow({ where: { id: ctx.branchId }, include: { tenant: { select: { gstin: true } } } });
  const mask = await phoneMasker(ctx);
  return cs.map((c) => ({ id: c.id, name: c.name, phone: mask(c.phone), optIn: c.waOptIn, limit: big(c.creditLimitPaise), due: bal.get(c.id) ?? 0, gstin: c.gstin, igst: saleTaxSplit(br.gstin ?? br.tenant.gstin, c, 0).inter }));
}

export async function createCustomer(ctx: Ctx, raw: CustomerInput & ConsentInput) {
  authorize(ctx, "sale");
  const i = customerSchema.parse(raw);
  if (i.creditLimit > 0 && !can(ctx, "credit")) throw new UserError("Your role cannot set a credit limit.");
  if (i.waOptIn && !i.phone) throw new UserError("WhatsApp opt-in needs a mobile number.");
  return db.$transaction(async (tx) => {
    if (i.phone && (await tx.customer.findFirst({ where: { tenantId: ctx.tenantId, phone: i.phone } }))) throw new UserError("A customer with this mobile number already exists.");
    const c = await tx.customer.create({ data: { tenantId: ctx.tenantId, name: i.name, phone: i.phone || null, waOptIn: i.waOptIn, optInAt: i.waOptIn ? new Date() : null, optInMethod: i.waOptIn ? `Counter, recorded by ${ctx.userName}` : null, creditLimitPaise: BigInt(i.creditLimit), gstin: i.gstin || null, stateCode: i.stateCode || null, address: i.address || null, pincode: i.pincode || null } });
    const consents = await applyConsents(tx, ctx, c, null, raw, "pos");
    await writeAudit(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: "Customer added", entity: "customer", entityId: c.id, detail: `${c.name}${c.gstin ? " · GSTIN " + c.gstin : ""}${consents.length ? " · consent " + consents.join(", ") : ""}` });
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
