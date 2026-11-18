import "server-only";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db, type Tx } from "@/server/db";
import { UserError } from "@/server/action";
import type { Ctx } from "@/server/context";
import { nextSeq } from "@/server/sequence";
import { zId } from "@/lib/id";
import { addDays, dateOnly, fiscalYear, isoOf, todayISO } from "@/lib/dates";
import { gstDocNo } from "@/lib/docno";
import { postVoucher } from "@/domain/accounting/post";
import { ACC } from "@/domain/accounting/accounts";
import { stateName } from "@/domain/accounting/gst";
import { distAuthorize, distCan } from "./context";
import { audit, distSettings, lockKey, num } from "./common";
import { activeSchemes, creditFor, isInterState, lockBatches, reservedUnits } from "./orders";
import { invoiceTotals, rateFor } from "./rules/pricing";
import { bestScheme } from "./rules/schemes";
import { allocateFefoReserved, ShortStockError, splitPaidFree } from "./rules/allocation";
import { assertMove } from "./rules/orderflow";

/** "W" + godown code: the invoice series of a godown (GST: ≤16 characters, unique per financial year). */
export const seriesOf = (code: string, kind: "W" | "C") => kind + code.replace(/[^A-Z0-9]/g, "").slice(0, 4);

type PostLine = { medicineId: string; batchId: string; paidUnits: number; units: number; rate: number; discPct: number; schemeId: string | null };

/**
 * Posts a wholesale tax invoice inside a transaction whose batches are already locked: checks stock, takes it out,
 * books Sundry debtors / Sales / Output GST, and opens a delivery. Shared by order invoicing and direct billing.
 */
async function postInvoice(tx: Tx, ctx: Ctx, a: { branchId: string; customerId: string; orderId: string | null; salesmanId: string | null; lines: PostLine[]; idempotencyKey: string }) {
  const [branch, cust, chem, meds, batches] = await Promise.all([
    tx.branch.findFirstOrThrow({ where: { id: a.branchId, tenantId: ctx.tenantId } }),
    tx.customer.findFirstOrThrow({ where: { id: a.customerId, tenantId: ctx.tenantId } }),
    tx.distChemist.findFirstOrThrow({ where: { customerId: a.customerId, tenantId: ctx.tenantId } }),
    tx.medicine.findMany({ where: { tenantId: ctx.tenantId, id: { in: a.lines.map((l) => l.medicineId) } } }),
    tx.batch.findMany({ where: { tenantId: ctx.tenantId, id: { in: a.lines.map((l) => l.batchId) } } }),
  ]);
  const today = todayISO();
  const inter = await isInterState(tx, ctx.tenantId, a.branchId, a.customerId);
  const priced = a.lines.map((l) => {
    const m = meds.find((x) => x.id === l.medicineId)!, b = batches.find((x) => x.id === l.batchId);
    if (!b || b.branchId !== a.branchId || b.medicineId !== m.id) throw new UserError(`${m?.name ?? "Product"}: batch not found in this godown.`);
    if (b.status !== "ok") throw new UserError(`${m.name} batch ${b.batchNo} is ${b.status}.`);
    if (isoOf(b.expiryDate) <= today) throw new UserError(`${m.name} batch ${b.batchNo} has expired.`);
    if (b.qtyAvailable < l.units) throw new UserError(`${m.name} batch ${b.batchNo}: only ${b.qtyAvailable} in stock.`);
    const pack = Math.max(1, m.packSize);
    if (l.units % pack || l.paidUnits % pack) throw new UserError(`${m.name}: quantities must be whole packs.`);
    return { l, m, b, qty: l.paidUnits / pack, free: (l.units - l.paidUnits) / pack };
  });
  // Lines with only free goods are priced at zero (qty 0); invoiceTotals needs qty ≥ 1, so price paid lines only.
  const paidIdx = priced.map((p, i) => (p.qty > 0 ? i : -1)).filter((i) => i >= 0);
  if (!paidIdx.length) throw new UserError("An invoice needs at least one paid line.");
  const t = invoiceTotals(paidIdx.map((i) => ({ qty: priced[i].qty, rate: priced[i].l.rate, gstRate: priced[i].m.gstRate, discPct: priced[i].l.discPct })), inter);
  const lineTotals = new Map(paidIdx.map((i, k) => [i, t.lines[k]]));
  const cost = priced.reduce((s, p) => s + (p.qty + p.free) * num(p.b.costPaise), 0);

  const fy = fiscalYear();
  const no = gstDocNo(seriesOf(branch.code, "W"), fy, await nextSeq(tx, ctx.tenantId, `DINV:${branch.id}:${fy}`), 5);
  const half = Math.floor(t.tax / 2);
  const v = await postVoucher(tx, {
    tenantId: ctx.tenantId, branchId: branch.id, type: "sales", userId: ctx.userId, refType: "dist_invoice", refId: no,
    narration: `${no} · ${cust.name}${inter ? " · IGST" : ""}`,
    lines: [
      { account: ACC.debtors, dr: t.total, partyType: "customer", partyId: cust.id },
      { account: ACC.sales, cr: t.taxable },
      ...(inter ? [{ account: ACC.igst, cr: t.igst }] : [{ account: ACC.cgst, cr: t.cgst }, { account: ACC.sgst, cr: t.sgst }]),
      t.roundOff >= 0 ? { account: ACC.roundOff, cr: t.roundOff } : { account: ACC.roundOff, dr: -t.roundOff },
    ],
  });
  void half;
  const inv = await tx.distInvoice.create({
    data: {
      tenantId: ctx.tenantId, branchId: branch.id, no, orderId: a.orderId, customerId: cust.id, salesmanId: a.salesmanId ?? chem.salesmanId,
      date: dateOnly(today), dueDate: dateOnly(addDays(today, chem.creditDays)), placeOfSupply: cust.stateCode ?? cust.gstin?.slice(0, 2) ?? branch.gstin?.slice(0, 2) ?? null,
      customerGstin: cust.gstin, igst: inter, grossPaise: BigInt(t.gross), discPaise: BigInt(t.disc), taxablePaise: BigInt(t.taxable), cgstPaise: BigInt(t.cgst), sgstPaise: BigInt(t.sgst), igstPaise: BigInt(t.igst),
      roundOffPaise: BigInt(t.roundOff), totalPaise: BigInt(t.total), costPaise: BigInt(cost), voucherId: v.id, idempotencyKey: a.idempotencyKey, createdBy: ctx.userId,
      lines: {
        create: priced.map((p, i) => {
          const lt = lineTotals.get(i);
          return {
            medicineId: p.m.id, batchId: p.b.id, qty: p.qty, freeQty: p.free, ratePaise: BigInt(p.l.rate), mrpPaise: p.b.mrpPaise, discPct: p.l.discPct, discPaise: BigInt(lt?.disc ?? 0),
            schemeId: p.l.schemeId, taxablePaise: BigInt(lt?.taxable ?? 0), gstRate: p.m.gstRate, taxPaise: BigInt(lt?.tax ?? 0), costPaise: BigInt((p.qty + p.free) * num(p.b.costPaise)),
          };
        }),
      },
    },
  });
  for (const p of priced) {
    await tx.batch.update({ where: { id: p.b.id }, data: { qtyAvailable: { decrement: p.l.units }, version: { increment: 1 } } });
    await tx.stockMovement.create({ data: { tenantId: ctx.tenantId, branchId: branch.id, batchId: p.b.id, qty: -p.l.units, type: "sale", refType: "dist_invoice", refId: inv.id, userId: ctx.userId, note: no } });
  }
  await tx.distDelivery.create({ data: { tenantId: ctx.tenantId, invoiceId: inv.id, status: "pending" } });
  await audit(tx, ctx, "Invoice raised", "dist_invoice", inv.id, `${no} · ${cust.name} · ${priced.length} line(s) · ₹${(t.total / 100).toFixed(2)}${inter ? " · IGST " + stateName(cust.stateCode) : ""}`);
  return { invoiceId: inv.id, no, total: t.total };
}

/** Invoices a packed order from exactly what was picked. */
export async function invoiceOrder(ctx: Ctx, orderId: string) {
  distAuthorize(ctx, "bill");
  return db.$transaction(async (tx) => {
    await lockKey(tx, "dist_order:" + orderId);
    const o = await tx.distOrder.findFirst({ where: { id: orderId, tenantId: ctx.tenantId }, include: { lines: true } });
    if (!o) throw new UserError("Order not found.");
    if (o.invoiceId) throw new UserError("This order is already invoiced.");
    assertMove(o.status, "invoiced");
    const pick = await tx.distPickList.findUnique({ where: { orderId }, include: { lines: true } });
    if (!pick || pick.status !== "packed") throw new UserError("Pack the order before invoicing.");
    await lockBatches(tx, ctx.tenantId, o.branchId, [...new Set(pick.lines.map((l) => l.medicineId))]);
    const meds = await tx.medicine.findMany({ where: { id: { in: pick.lines.map((l) => l.medicineId) } }, select: { id: true, packSize: true } });
    const lines: PostLine[] = [];
    for (const pl of pick.lines) {
      const picked = pl.pickedUnits ?? 0;
      if (picked <= 0) continue;
      const ol = o.lines.find((x) => x.id === pl.orderLineId)!;
      const pack = Math.max(1, meds.find((m) => m.id === pl.medicineId)?.packSize ?? 1);
      // A short pick comes off free goods first, then paid goods.
      const paid = Math.min(pl.paidUnits, picked);
      lines.push({ medicineId: pl.medicineId, batchId: pl.batchId, units: Math.floor(picked / pack) * pack, paidUnits: Math.floor(paid / pack) * pack, rate: num(ol.ratePaise), discPct: num(ol.discPct), schemeId: ol.schemeId });
    }
    const usable = lines.filter((l) => l.units > 0);
    if (!usable.length) throw new UserError("Nothing was picked.");
    // Release the reservation first so the stock check sees the picked units as available to this invoice.
    await tx.distPickList.update({ where: { id: pick.id }, data: { status: "invoiced" } });
    const r = await postInvoice(tx, ctx, { branchId: o.branchId, customerId: o.customerId, orderId: o.id, salesmanId: o.salesmanId, lines: usable, idempotencyKey: "order:" + o.id });
    await tx.distOrder.update({ where: { id: o.id }, data: { status: "invoiced", invoiceId: r.invoiceId, version: { increment: 1 } } });
    return r;
  }, { timeout: 20000 });
}

// ───────────── Direct (counter) billing ─────────────

export const directSchema = z.object({
  customerId: zId("Choose the chemist."),
  idempotencyKey: z.string().regex(/^[A-Za-z0-9_-]{8,64}$/, "Missing bill key; reload and try again."),
  overrideReason: z.string().trim().max(200).default(""),
  lines: z.array(z.object({
    medicineId: zId(), qty: z.coerce.number().int().min(1, "Quantity must be at least 1."), batchId: z.string().default(""),
    rate: z.union([z.string(), z.number()]).optional(), discPct: z.coerce.number().min(0).max(100).optional(),
  })).min(1, "Add at least one product.").max(300),
});
export type DirectInput = z.input<typeof directSchema>;

/**
 * Counter / phone bill without a separate order: prices from the chemist's rate and the best scheme, FEFO batches
 * (or a chosen batch), credit control (a hold needs the override permission and a reason).
 * A rate below the chemist's rate or extra discount also needs the override permission.
 */
export async function directInvoice(ctx: Ctx, raw: DirectInput) {
  distAuthorize(ctx, "bill");
  const i = directSchema.parse(raw);
  const seen = await db.distInvoice.findUnique({ where: { tenantId_idempotencyKey: { tenantId: ctx.tenantId, idempotencyKey: i.idempotencyKey } } });
  if (seen) return { invoiceId: seen.id, no: seen.no, total: num(seen.totalPaise), replayed: true };
  try {
    return await db.$transaction(async (tx) => {
      await lockKey(tx, "party:" + i.customerId);
      const chem = await tx.distChemist.findFirst({ where: { customerId: i.customerId, tenantId: ctx.tenantId } });
      if (!chem) throw new UserError("Chemist not found.");
      const settings = await distSettings(ctx.tenantId, tx);
      const ids = [...new Set(i.lines.map((l) => l.medicineId))];
      if (ids.length !== i.lines.length) throw new UserError("A product appears twice. Combine the lines.");
      const [dps, specials, schemes] = await Promise.all([
        tx.distProduct.findMany({ where: { tenantId: ctx.tenantId, medicineId: { in: ids } } }),
        tx.distSpecialRate.findMany({ where: { tenantId: ctx.tenantId, customerId: chem.customerId, medicineId: { in: ids } } }),
        activeSchemes(tx, ctx.tenantId),
      ]);
      const batches = await lockBatches(tx, ctx.tenantId, ctx.branchId, ids);
      const reserved = await reservedUnits(tx, ctx.tenantId, batches.map((b) => b.id));
      const lines: PostLine[] = [];
      const overrides: string[] = [];
      for (const l of i.lines) {
        const d = dps.find((x) => x.medicineId === l.medicineId);
        const name = batches.find((b) => b.medicineId === l.medicineId)?.medicine.name ?? "Product";
        if (!d) throw new UserError(`${name} has no wholesale rate. Set it up under Products.`);
        if (d.discontinued) throw new UserError(`${name} is discontinued.`);
        const pack = Math.max(1, batches.find((b) => b.medicineId === l.medicineId)?.medicine.packSize ?? 1);
        const sp = specials.find((x) => x.medicineId === l.medicineId);
        const listRate = rateFor({ ptr: num(d.ptrPaise), pts: num(d.ptsPaise) }, chem.priceTier, sp ? { rate: num(sp.ratePaise), validTo: sp.validTo ? isoOf(sp.validTo) : null } : null);
        const sch = bestScheme(schemes, { medicineId: l.medicineId, companyId: d.companyId, qty: l.qty, customerId: chem.customerId }, todayISO());
        const rate = l.rate === undefined || String(l.rate).trim() === "" ? listRate : Math.round(Number(l.rate) * 100);
        const disc = l.discPct ?? sch.discPct;
        if (!Number.isFinite(rate) || rate <= 0) throw new UserError(`${name}: enter a valid rate.`);
        if (rate < listRate || disc > sch.discPct) overrides.push(`${name} rate ₹${(rate / 100).toFixed(2)} (list ₹${(listRate / 100).toFixed(2)}) disc ${disc}%`);
        const units = (l.qty + sch.freeQty) * pack;
        let allocs;
        try {
          if (l.batchId) {
            const b = batches.find((x) => x.id === l.batchId && x.medicineId === l.medicineId);
            if (!b) throw new UserError(`${name}: that batch isn’t in this godown.`);
            allocs = allocateFefoReserved([{ id: b.id, medicineId: b.medicineId, batchNo: b.batchNo, expiry: isoOf(b.expiryDate), qtyAvailable: b.qtyAvailable, status: b.status }], l.medicineId, units, { reserved, today: todayISO(), minShelfDays: 1, packSize: pack });
          } else allocs = allocateFefoReserved(batches.map((b) => ({ id: b.id, medicineId: b.medicineId, batchNo: b.batchNo, expiry: isoOf(b.expiryDate), qtyAvailable: b.qtyAvailable, status: b.status })), l.medicineId, units, { reserved, today: todayISO(), minShelfDays: settings.minShelfDays, packSize: pack });
        } catch (e) {
          if (e instanceof ShortStockError) throw new UserError(`${name}: only ${e.available} packs available${sch.freeQty ? ` (needed ${l.qty} + ${sch.freeQty} free)` : ""}.`);
          throw e;
        }
        for (const a of splitPaidFree(allocs, l.qty * pack)) {
          reserved[a.batchId] = (reserved[a.batchId] ?? 0) + a.units;
          lines.push({ medicineId: l.medicineId, batchId: a.batchId, units: a.units, paidUnits: a.paidUnits, rate, discPct: disc, schemeId: sch.schemeId });
        }
      }
      if (overrides.length && !distCan(ctx, "creditOverride")) throw new UserError(`Rates below the chemist’s rate need a manager: ${overrides.join("; ")}.`);
      const inter = await isInterState(tx, ctx.tenantId, ctx.branchId, chem.customerId);
      const meds = await tx.medicine.findMany({ where: { id: { in: ids } }, select: { id: true, gstRate: true, packSize: true } });
      const value = invoiceTotals(lines.filter((l) => l.paidUnits > 0).map((l) => { const m = meds.find((x) => x.id === l.medicineId)!; return { qty: l.paidUnits / Math.max(1, m.packSize), rate: l.rate, gstRate: m.gstRate, discPct: l.discPct }; }), inter).total;
      const credit = await creditFor(tx, ctx.tenantId, chem.customerId, value);
      if (credit.hard) throw new UserError(`Can’t bill: ${credit.reasons.join(" ")}`);
      if (!credit.ok) {
        if (!distCan(ctx, "creditOverride") || i.overrideReason.length < 5) throw new UserError(`Credit hold: ${credit.reasons.join(" ")} ${distCan(ctx, "creditOverride") ? "Enter a reason to override." : "A manager with credit override must bill this."}`);
        if (settings.creditMode === "block") throw new UserError(`Credit rules block this bill: ${credit.reasons.join(" ")}`);
      }
      const r = await postInvoice(tx, ctx, { branchId: ctx.branchId, customerId: chem.customerId, orderId: null, salesmanId: null, lines, idempotencyKey: i.idempotencyKey });
      if (!credit.ok) await audit(tx, ctx, "Billed over credit hold", "dist_invoice", r.invoiceId, `${r.no} · ${credit.reasons.join(" ")} · reason: ${i.overrideReason}`);
      if (overrides.length) await audit(tx, ctx, "Rate override", "dist_invoice", r.invoiceId, `${r.no} · ${overrides.join("; ")}`);
      return { ...r, replayed: false };
    }, { timeout: 20000 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      const s = await db.distInvoice.findUnique({ where: { tenantId_idempotencyKey: { tenantId: ctx.tenantId, idempotencyKey: i.idempotencyKey } } });
      if (s) return { invoiceId: s.id, no: s.no, total: num(s.totalPaise), replayed: true };
    }
    throw e;
  }
}

// ───────────── Cancellation ─────────────

/**
 * Cancels an invoice on the day it was raised (later corrections are credit notes): stock goes back to its batches,
 * the sales voucher is reversed, and the cancellation is recorded. The invoice itself is never edited.
 */
export async function cancelInvoice(ctx: Ctx, id: string, reason: string) {
  distAuthorize(ctx, "cancelBill");
  if (reason.trim().length < 5) throw new UserError("Give the reason for cancelling.");
  return db.$transaction(async (tx) => {
    await lockKey(tx, "dist_invoice:" + id);
    const inv = await tx.distInvoice.findFirst({ where: { id, tenantId: ctx.tenantId }, include: { lines: true } });
    if (!inv) throw new UserError("Invoice not found.");
    if (await tx.distInvoiceCancel.findUnique({ where: { invoiceId: id } })) throw new UserError(`${inv.no} is already cancelled.`);
    if (isoOf(inv.date) !== todayISO()) throw new UserError("Only today’s invoices can be cancelled. Raise a credit note instead.");
    if (await tx.distReturn.count({ where: { invoiceId: id } })) throw new UserError("This invoice has a credit note. It can’t be cancelled.");
    const del = await tx.distDelivery.findUnique({ where: { invoiceId: id } });
    if (del && del.status === "delivered") throw new UserError("Delivered invoices can’t be cancelled. Raise a credit note.");
    if (await tx.eInvoice.count({ where: { tenantId: ctx.tenantId, docType: "dist_invoice", docId: id, kind: "irn" } })) throw new UserError("Cancel the IRN on the e-invoice portal first, then record it here.");
    const voucher = await tx.voucher.findUniqueOrThrow({ where: { id: inv.voucherId }, include: { lines: true } });
    const rev = await postVoucher(tx, {
      tenantId: ctx.tenantId, branchId: inv.branchId, type: "reversal", userId: ctx.userId, refType: "dist_invoice_cancel", refId: inv.id, reversesId: voucher.id,
      narration: `Cancelled ${inv.no} · ${reason.trim()}`,
      lines: voucher.lines.map((l) => ({ account: l.account, dr: num(l.creditPaise), cr: num(l.debitPaise), partyType: (l.partyType ?? undefined) as "customer" | undefined, partyId: l.partyId ?? undefined })),
    });
    const meds = await tx.medicine.findMany({ where: { id: { in: inv.lines.map((l) => l.medicineId) } }, select: { id: true, packSize: true } });
    for (const l of inv.lines) {
      const units = (l.qty + l.freeQty) * Math.max(1, meds.find((m) => m.id === l.medicineId)?.packSize ?? 1);
      await tx.batch.update({ where: { id: l.batchId }, data: { qtyAvailable: { increment: units }, version: { increment: 1 } } });
      await tx.stockMovement.create({ data: { tenantId: ctx.tenantId, branchId: inv.branchId, batchId: l.batchId, qty: units, type: "return", refType: "dist_invoice_cancel", refId: inv.id, userId: ctx.userId, note: `Cancelled ${inv.no}` } });
    }
    await tx.distInvoiceCancel.create({ data: { invoiceId: inv.id, tenantId: ctx.tenantId, reason: reason.trim(), voucherId: rev.id, by: ctx.userId } });
    if (del) await tx.distDelivery.update({ where: { id: del.id }, data: { status: "failed", failReason: "Invoice cancelled", updatedBy: ctx.userId } });
    if (inv.orderId) await tx.distOrder.update({ where: { id: inv.orderId }, data: { status: "cancelled", rejectReason: `Invoice ${inv.no} cancelled: ${reason.trim()}`, version: { increment: 1 } } });
    await audit(tx, ctx, "Invoice cancelled", "dist_invoice", inv.id, `${inv.no} · ₹${(num(inv.totalPaise) / 100).toFixed(2)} · ${reason.trim()}`);
    return rev.no;
  });
}

// ───────────── Views ─────────────

export async function listInvoices(ctx: Ctx, opts: { customerId?: string; from?: string; to?: string; q?: string; take?: number } = {}) {
  const rows = await db.distInvoice.findMany({
    where: {
      tenantId: ctx.tenantId, branchId: { in: ctx.branches.map((b) => b.id) }, ...(opts.customerId ? { customerId: opts.customerId } : {}),
      ...(opts.from || opts.to ? { date: { ...(opts.from ? { gte: dateOnly(opts.from) } : {}), ...(opts.to ? { lte: dateOnly(opts.to) } : {}) } } : {}),
      ...(opts.q ? { no: { contains: opts.q.toUpperCase() } } : {}),
    },
    orderBy: [{ date: "desc" }, { no: "desc" }], take: opts.take ?? 200,
  });
  const [custs, cancels, dels] = await Promise.all([
    db.customer.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.customerId))] } }, select: { id: true, name: true } }),
    db.distInvoiceCancel.findMany({ where: { invoiceId: { in: rows.map((r) => r.id) } } }),
    db.distDelivery.findMany({ where: { invoiceId: { in: rows.map((r) => r.id) } } }),
  ]);
  return rows.map((r) => ({ id: r.id, no: r.no, date: isoOf(r.date), dueDate: isoOf(r.dueDate), customerId: r.customerId, customer: custs.find((c) => c.id === r.customerId)?.name ?? "—", total: num(r.totalPaise), taxable: num(r.taxablePaise), tax: num(r.cgstPaise + r.sgstPaise + r.igstPaise), cancelled: cancels.some((c) => c.invoiceId === r.id), delivery: dels.find((d) => d.invoiceId === r.id)?.status ?? null }));
}

export async function invoiceView(tenantId: string, id: string) {
  const inv = await db.distInvoice.findFirst({ where: { id, tenantId }, include: { lines: true } });
  if (!inv) return null;
  const [tenant, branch, cust, chem, meds, batches, cancel, returns, einv] = await Promise.all([
    db.tenant.findUniqueOrThrow({ where: { id: tenantId } }),
    db.branch.findUniqueOrThrow({ where: { id: inv.branchId } }),
    db.customer.findUniqueOrThrow({ where: { id: inv.customerId } }),
    db.distChemist.findUnique({ where: { customerId: inv.customerId } }),
    db.medicine.findMany({ where: { id: { in: inv.lines.map((l) => l.medicineId) } } }),
    db.batch.findMany({ where: { id: { in: inv.lines.map((l) => l.batchId) } } }),
    db.distInvoiceCancel.findUnique({ where: { invoiceId: id } }),
    db.distReturn.findMany({ where: { invoiceId: id }, include: { lines: true } }),
    db.eInvoice.findMany({ where: { tenantId, docType: "dist_invoice", docId: id }, orderBy: { at: "desc" }, take: 1 }),
  ]);
  const company = await db.distProduct.findMany({ where: { medicineId: { in: meds.map((m) => m.id) } }, select: { medicineId: true, companyId: true } });
  const companies = await db.distCompany.findMany({ where: { tenantId, id: { in: company.map((c) => c.companyId).filter((x): x is string => !!x) } } });
  return {
    id: inv.id, no: inv.no, date: isoOf(inv.date), dueDate: isoOf(inv.dueDate), igst: inv.igst, placeOfSupply: inv.placeOfSupply, pos: stateName(inv.placeOfSupply),
    seller: { name: tenant.legalName ?? tenant.name, gstin: branch.gstin ?? tenant.gstin, dl: branch.drugLicence, address: branch.address, godown: branch.name, phone: tenant.phone },
    buyer: { id: cust.id, name: cust.name, gstin: inv.customerGstin, address: cust.address, pincode: cust.pincode, dl: chem ? `${chem.dl20b ?? ""} / ${chem.dl21b ?? ""}` : "", phone: cust.phone },
    lines: inv.lines.map((l) => {
      const m = meds.find((x) => x.id === l.medicineId)!, b = batches.find((x) => x.id === l.batchId)!;
      const ret = returns.flatMap((r) => r.lines).filter((r) => r.invoiceLineId === l.id).reduce((a, r) => a + r.qty, 0);
      return { id: l.id, name: m.name, pack: m.pack, hsn: m.hsn, company: companies.find((c) => c.id === company.find((x) => x.medicineId === m.id)?.companyId)?.shortName ?? companies.find((c) => c.id === company.find((x) => x.medicineId === m.id)?.companyId)?.name ?? m.manufacturer,
        batchNo: b.batchNo, expiry: isoOf(b.expiryDate), qty: l.qty, freeQty: l.freeQty, rate: num(l.ratePaise), mrp: num(l.mrpPaise), discPct: num(l.discPct), disc: num(l.discPaise), taxable: num(l.taxablePaise), gstRate: l.gstRate, tax: num(l.taxPaise), returned: ret };
    }),
    gross: num(inv.grossPaise), disc: num(inv.discPaise), taxable: num(inv.taxablePaise), cgst: num(inv.cgstPaise), sgst: num(inv.sgstPaise), igstAmt: num(inv.igstPaise), roundOff: num(inv.roundOffPaise), total: num(inv.totalPaise),
    cancelled: cancel ? { reason: cancel.reason, at: cancel.at } : null,
    returns: returns.map((r) => ({ id: r.id, no: r.no, total: num(r.totalPaise), at: r.at })),
    irn: einv[0]?.irn ?? null,
  };
}
export type DistInvoiceView = NonNullable<Awaited<ReturnType<typeof invoiceView>>>;
