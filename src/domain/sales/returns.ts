import "server-only";
import { db, type Tx } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorize, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { nextSeq, pad } from "@/server/sequence";
import { daysTo, fiscalYear, startOfTodayIST, todayISO } from "@/lib/dates";
import { big, inr, shareOf } from "@/lib/money";
import { postVoucher, type Line } from "@/domain/accounting/post";
import { ACC } from "@/domain/accounting/accounts";

import { returnSchema, type ReturnInput } from "./contracts";
export type { ReturnInput };

/** Current open shift for this counter (or this user on a browser counter). */
export function openShiftWhere(ctx: Ctx) {
  return { tenantId: ctx.tenantId, branchId: ctx.branchId, closedAt: null, ...(ctx.counterId ? { counter: ctx.counterId } : { counter: "user:" + ctx.userId }) };
}

/** The counter's open shift, share-locked so closeShift waits for this transaction and counts its cash. */
export async function lockOpenShift(tx: Tx, ctx: Ctx) {
  const s = await tx.shift.findFirst({ where: openShiftWhere(ctx) });
  if (!s) return null;
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "Shift" WHERE id = ${s.id} AND "closedAt" IS NULL FOR SHARE`;
  return rows.length ? s : null;
}

/** Whether a sale can still be voided: same day (India time), not voided, nothing returned yet. */
export const voidable = (s: { at: Date; voided?: unknown; items: { returnedQty: number }[] }) =>
  !s.voided && todayISO(s.at) === todayISO() && s.items.every((i) => i.returnedQty === 0);

export async function recentInvoices(ctx: Ctx, q: string) {
  const term = q.trim();
  const rows = await db.sale.findMany({
    where: { tenantId: ctx.tenantId, branchId: ctx.branchId, ...(term ? { OR: [{ invoiceNo: { contains: term, mode: "insensitive" } }, { customer: { name: { contains: term, mode: "insensitive" } } }] } : {}) },
    include: { customer: { select: { name: true } }, voided: { select: { id: true } } }, orderBy: { at: "desc" }, take: 30,
  });
  return rows.map((s) => ({ id: s.id, no: s.invoiceNo, at: s.at.toISOString(), customer: s.customer?.name ?? "Walk-in", total: big(s.totalPaise), voided: !!s.voided }));
}

export async function returnableLines(ctx: Ctx, saleId: string) {
  const s = await db.sale.findFirst({ where: { id: saleId, tenantId: ctx.tenantId }, include: { items: true, customer: true, voided: true } });
  if (!s) return null;
  const [meds, batches] = await Promise.all([
    db.medicine.findMany({ where: { id: { in: s.items.map((i) => i.medicineId) } }, select: { id: true, name: true } }),
    db.batch.findMany({ where: { id: { in: s.items.map((i) => i.batchId) } }, select: { id: true, batchNo: true, expiryDate: true } }),
  ]);
  return {
    id: s.id, no: s.invoiceNo, customer: s.customer?.name ?? null, payMode: s.payMode, hasCustomer: !!s.customerId, total: big(s.totalPaise),
    voided: s.voided ? { at: s.voided.at.toISOString(), reason: s.voided.reason } : null, canVoid: voidable(s),
    lines: s.items.map((i) => {
      const b = batches.find((x) => x.id === i.batchId)!;
      return { itemId: i.id, name: meds.find((m) => m.id === i.medicineId)!.name, batchNo: b.batchNo, expired: daysTo(b.expiryDate) <= 0, sold: i.qty, returned: i.returnedQty, unitNet: (big(i.mrpPaise) * i.qty - big(i.discountPaise)) / i.qty };
    }),
  };
}

/** Issues a credit note: refunds the net paid (after discount), reverses GST, restocks sealed goods. */
export async function processReturn(ctx: Ctx, raw: ReturnInput, opts: { codUncollected?: boolean } = {}) {
  authorize(ctx, "refund");
  const i = returnSchema.parse(raw);
  const wanted = i.lines.filter((l) => l.qty > 0);
  if (!wanted.length) throw new UserError("Enter a return quantity.");
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "SaleItem" WHERE "saleId" = ${i.saleId} FOR UPDATE`;
    if (!rows.length) throw new UserError("Invoice not found.");
    const sale = await tx.sale.findFirst({ where: { id: i.saleId, tenantId: ctx.tenantId }, include: { items: true, customer: true, voided: true } });
    if (!sale) throw new UserError("Invoice not found.");
    if (sale.voided) throw new UserError(`${sale.invoiceNo} was voided; nothing is left to return.`);
    if (sale.branchId !== ctx.branchId) throw new UserError("Process returns at the branch that made the sale.");
    if (i.refundMode === "Adjust customer credit" && !sale.customerId) throw new UserError("Walk-in sales can’t be refunded to customer credit.");
    // Credit sales are always settled against the customer's balance; an undelivered cash-on-delivery
    // order (from Orders) comes off what the delivery staff owe.
    const cod = sale.payMode === "cod" && !!opts.codUncollected;
    const mode = sale.payMode === "credit" ? "Adjust customer credit" : cod ? "COD not collected" : i.refundMode;

    let refund = 0, taxable = 0, tax = 0;
    const taken = new Map<string, number>();
    const out: { itemId: string; name: string; batchNo: string; qty: number; amount: number; restocked: boolean }[] = [];
    for (const w of wanted) {
      const it = sale.items.find((x) => x.id === w.itemId);
      if (!it) throw new UserError("A line doesn’t belong to this invoice.");
      const done = it.returnedQty + (taken.get(it.id) ?? 0);
      if (w.qty > it.qty - done) throw new UserError(`Only ${it.qty - done} can still be returned for one of the lines.`);
      taken.set(it.id, (taken.get(it.id) ?? 0) + w.qty);
      const net = big(it.mrpPaise) * it.qty - big(it.discountPaise);
      const amt = shareOf(net, it.qty, done, w.qty);
      const tb = shareOf(big(it.taxablePaise), it.qty, done, w.qty);
      refund += amt; taxable += tb; tax += amt - tb;
      const b = await tx.batch.findUniqueOrThrow({ where: { id: it.batchId }, include: { medicine: { select: { name: true } } } });
      // Expired or blocked stock is never put back on sale.
      const restock = i.condition === "sealed" && daysTo(b.expiryDate) > 0 && b.status === "ok";
      await tx.saleItem.update({ where: { id: it.id }, data: { returnedQty: { increment: w.qty } } });
      if (restock) await tx.batch.update({ where: { id: b.id }, data: { qtyAvailable: { increment: w.qty }, version: { increment: 1 } } });
      out.push({ itemId: it.id, name: b.medicine.name, batchNo: b.batchNo, qty: w.qty, amount: amt, restocked: restock });
      await tx.stockMovement.create({ data: { tenantId: ctx.tenantId, branchId: ctx.branchId, batchId: b.id, qty: restock ? w.qty : 0, type: restock ? "return" : "return_damaged", refType: "sales_return", refId: sale.id, userId: ctx.userId, note: restock ? "Sales return, restocked" : "Sales return, not restocked" } });
    }
    const fy = fiscalYear();
    const cn = `CN-${fy}-${pad(await nextSeq(tx, ctx.tenantId, "CN:" + fy))}`;
    const shift = await lockOpenShift(tx, ctx);
    const half = Math.floor(tax / 2);
    const credit: Line = cod ? { account: ACC.codClearing, cr: refund } : mode === "Cash" ? { account: ACC.cash, cr: refund } : mode === "UPI refund" ? { account: ACC.bank, cr: refund } : { account: ACC.debtors, cr: refund, partyType: "customer", partyId: sale.customerId! };
    const ret = await tx.salesReturn.create({ data: { tenantId: ctx.tenantId, branchId: ctx.branchId, creditNoteNo: cn, saleId: sale.id, reason: i.reason, condition: i.condition, refundMode: mode, amountPaise: BigInt(refund), userId: ctx.userId, shiftId: shift?.id ?? null, lines: out } });
    await postVoucher(tx, {
      tenantId: ctx.tenantId, branchId: ctx.branchId, type: "credit_note", userId: ctx.userId, refType: "sales_return", refId: ret.id, no: cn,
      narration: `${cn} · return against ${sale.invoiceNo} · ${i.reason}`,
      lines: [{ account: ACC.salesReturns, dr: taxable }, { account: ACC.cgst, dr: half }, { account: ACC.sgst, dr: tax - half }, credit],
    });
    await writeAudit(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: `Refund processed ${cn}`, entity: "sales_return", entityId: ret.id, detail: `${sale.invoiceNo} · ${inr(refund)} · ${mode} · ${i.condition}` });
    return { id: ret.id, creditNote: cn, amount: refund, mode };
  });
}

/** Everything needed to print a credit note. GST totals come from its voucher, so they match the books. */
export async function creditNoteData(ctx: Ctx, id: string) {
  const r = await db.salesReturn.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!r) return null;
  const [sale, branch, tenant, user, voucher] = await Promise.all([
    db.sale.findUniqueOrThrow({ where: { id: r.saleId }, include: { customer: true, items: true } }),
    db.branch.findUniqueOrThrow({ where: { id: r.branchId } }),
    db.tenant.findUniqueOrThrow({ where: { id: r.tenantId } }),
    db.user.findUnique({ where: { id: r.userId }, select: { name: true } }),
    db.voucher.findFirst({ where: { tenantId: r.tenantId, refType: "sales_return", refId: r.id }, include: { lines: true } }),
  ]);
  const meds = await db.medicine.findMany({ where: { id: { in: sale.items.map((i) => i.medicineId) } }, select: { id: true, hsn: true } });
  const sum = (acc: string) => (voucher?.lines ?? []).filter((l) => l.account === acc).reduce((a, l) => a + big(l.debitPaise), 0);
  const lines = (r.lines as { itemId: string; name: string; batchNo: string; qty: number; amount: number; restocked: boolean }[]).map((l) => {
    const it = sale.items.find((x) => x.id === l.itemId);
    return { name: l.name, batchNo: l.batchNo, qty: l.qty, amount: l.amount, restocked: l.restocked, gstRate: it?.gstRate ?? 0, hsn: meds.find((m) => m.id === it?.medicineId)?.hsn ?? "" };
  });
  return {
    id: r.id, no: r.creditNoteNo, at: r.at.toISOString(), reason: r.reason, condition: r.condition, refundMode: r.refundMode, by: user?.name ?? "",
    invoiceNo: sale.invoiceNo, invoiceAt: sale.at.toISOString(),
    pharmacy: { name: tenant.name, legalName: tenant.legalName, gstin: branch.gstin ?? tenant.gstin, address: branch.address, dl: branch.drugLicence },
    customer: sale.customer ? { name: sale.customer.name, phone: sale.customer.phone } : null,
    lines, totals: { taxable: sum(ACC.salesReturns), cgst: sum(ACC.cgst), sgst: sum(ACC.sgst), total: big(r.amountPaise) },
  };
}
export type CreditNote = NonNullable<Awaited<ReturnType<typeof creditNoteData>>>;

export async function todaysCreditNotes(ctx: Ctx) {
  const rows = await db.salesReturn.findMany({ where: { tenantId: ctx.tenantId, branchId: ctx.branchId, at: { gte: startOfTodayIST() } }, orderBy: { at: "desc" } });
  const sales = await db.sale.findMany({ where: { id: { in: rows.map((r) => r.saleId) } }, include: { customer: { select: { name: true } } } });
  return rows.map((r) => { const s = sales.find((x) => x.id === r.saleId); return { id: r.id, no: r.creditNoteNo, invoice: s?.invoiceNo ?? "", customer: s?.customer?.name ?? "Walk-in", reason: r.reason, mode: r.refundMode, amount: big(r.amountPaise) }; });
}

// ───────────── Shifts ─────────────

/** Cash a shift's drawer should hold: float + cash sales + rider COD handovers − cash refunds − cash expenses. */
export async function expected(shift: { id: string; openingPaise: bigint; openedAt: Date; openedBy: string; branchId: string; tenantId: string }, q: Tx = db) {
  const [cashSales, refunds, voids, expenses, cod] = await Promise.all([
    q.$queryRaw<{ s: bigint | null }[]>`SELECT SUM(p."amountPaise") s FROM "Payment" p JOIN "Sale" x ON x.id = p."saleId" WHERE x."shiftId" = ${shift.id} AND p.mode = 'cash'`,
    q.salesReturn.aggregate({ where: { shiftId: shift.id, refundMode: "Cash" }, _sum: { amountPaise: true } }),
    q.saleVoid.aggregate({ where: { shiftId: shift.id }, _sum: { cashRefundPaise: true } }),
    q.$queryRaw<{ s: bigint | null }[]>`SELECT SUM(l."creditPaise") s FROM "LedgerLine" l JOIN "Voucher" v ON v.id = l."voucherId"
      WHERE v."tenantId" = ${shift.tenantId} AND v."branchId" = ${shift.branchId} AND v."refType" = 'expense' AND v."postedBy" = ${shift.openedBy} AND v."postedAt" >= ${shift.openedAt} AND l.account = ${ACC.cash}`,
    q.riderSettlement.aggregate({ where: { shiftId: shift.id }, _sum: { countedPaise: true } }),
  ]);
  const open = big(shift.openingPaise), cash = Number(cashSales[0]?.s ?? 0), codIn = big(cod._sum.countedPaise), ref = big(refunds._sum.amountPaise) + big(voids._sum.cashRefundPaise), exp = Number(expenses[0]?.s ?? 0);
  return { open, cash, cod: codIn, refunds: ref, expenses: exp, expected: open + cash + codIn - ref - exp };
}

export async function currentShift(ctx: Ctx) {
  const s = await db.shift.findFirst({ where: openShiftWhere(ctx), orderBy: { openedAt: "desc" } });
  const last = await db.shift.findFirst({ where: { tenantId: ctx.tenantId, branchId: ctx.branchId, counter: ctx.counterId ?? "user:" + ctx.userId, closedAt: { not: null } }, orderBy: { closedAt: "desc" } });
  return {
    open: s ? { id: s.id, openedAt: s.openedAt.toISOString(), ...(await expected(s)) } : null,
    last: last ? { closedAt: last.closedAt!.toISOString(), expected: big(last.expectedPaise), counted: big(last.countedPaise) } : null,
  };
}

export async function openShift(ctx: Ctx, openingRupees: string) {
  authorize(ctx, "sale");
  const open = Math.round((parseFloat(openingRupees) || 0) * 100);
  if (open < 0) throw new UserError("Opening float can’t be negative.");
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"shift:" + ctx.branchId + (ctx.counterId ?? ctx.userId)}))`;
    if (await tx.shift.findFirst({ where: openShiftWhere(ctx) })) throw new UserError("A shift is already open on this counter.");
    const s = await tx.shift.create({ data: { tenantId: ctx.tenantId, branchId: ctx.branchId, counter: ctx.counterId ?? "user:" + ctx.userId, userId: ctx.userId, openedBy: ctx.userId, openingPaise: BigInt(open) } });
    await writeAudit(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: "Shift opened", entity: "shift", entityId: s.id, detail: `${ctx.counterName ?? "Browser counter"} · float ${inr(open)}` });
  });
}

/** Closes the shift and posts any difference to Cash short/excess. */
export async function closeShift(ctx: Ctx, countedRupees: string) {
  authorize(ctx, "sale");
  if (countedRupees.trim() === "" || !(parseFloat(countedRupees) >= 0)) throw new UserError("Count the drawer and enter the amount.");
  const counted = Math.round(parseFloat(countedRupees) * 100);
  return db.$transaction(async (tx) => {
    const s = await tx.shift.findFirst({ where: openShiftWhere(ctx) });
    if (!s) throw new UserError("No open shift on this counter.");
    // Closing first takes the row lock: in-flight sales and refunds holding the shift (lockOpenShift)
    // commit before this proceeds, and later ones see it closed, so the expected cash below is final.
    const r = await tx.shift.updateMany({ where: { id: s.id, closedAt: null }, data: { closedAt: new Date(), closedBy: ctx.userId, countedPaise: BigInt(counted) } });
    if (!r.count) throw new UserError("This shift was already closed.");
    const e = await expected(s, tx);
    const diff = counted - e.expected;
    await tx.shift.update({ where: { id: s.id }, data: { expectedPaise: BigInt(e.expected) } });
    if (diff) await postVoucher(tx, {
      tenantId: ctx.tenantId, branchId: ctx.branchId, type: "journal", userId: ctx.userId, refType: "shift", refId: s.id,
      narration: `Cash ${diff < 0 ? "short" : "excess"} at shift close · ${ctx.counterName ?? "Browser counter"}`,
      lines: diff < 0 ? [{ account: ACC.cashDiff, dr: -diff }, { account: ACC.cash, cr: -diff }] : [{ account: ACC.cash, dr: diff }, { account: ACC.cashDiff, cr: diff }],
    });
    await writeAudit(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: "Shift closed", entity: "shift", entityId: s.id, detail: `Expected ${inr(e.expected)} · counted ${inr(counted)} · difference ${inr(diff)}` });
    return { expected: e.expected, counted, diff };
  });
}
