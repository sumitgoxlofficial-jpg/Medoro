import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import type { Ctx } from "@/server/context";
import { nextSeq, pad } from "@/server/sequence";
import { zId } from "@/lib/id";
import { daysTo, fiscalYear, isoOf, todayISO } from "@/lib/dates";
import { gstDocNo } from "@/lib/docno";
import { postVoucher } from "@/domain/accounting/post";
import { ACC } from "@/domain/accounting/accounts";
import { gstReversal, lockBatch, returnValue } from "@/domain/inventory/adjust";
import { distAuthorize, distView } from "./context";
import { audit, lockKey, num } from "./common";
import { seriesOf } from "./billing";
import { shareOfLine } from "./rules/pricing";
import { claimEligibility, DEFAULT_POLICY, expectedCredit, expiryBand, type ClaimPolicy } from "./rules/expiry";

// ───────────── Sales returns (credit notes) ─────────────

export const RETURN_CONDITIONS = { saleable: "Saleable (back to stock)", expired: "Expired (to claims)", damaged: "Damaged / breakage (to claims)" } as const;

export const returnSchema = z.object({
  invoiceId: zId(),
  reason: z.string().trim().min(3, "Enter the reason for the return.").max(200),
  lines: z.array(z.object({
    invoiceLineId: zId(), qty: z.coerce.number().int().min(1, "Enter the quantity returned."),
    condition: z.enum(["saleable", "expired", "damaged"]), creditPct: z.coerce.number().min(0).max(100).default(100),
  })).min(1, "Choose what is coming back."),
});
export type ReturnInput = z.input<typeof returnSchema>;

/**
 * Credit note against a wholesale invoice. Saleable goods go back to their batch; expired or damaged goods go to the
 * batch's quarantined stock, from where they are claimed on the principal. Credit is the line's value per pack
 * (paid and free packs share it) × the credit % agreed with the chemist; GST is reduced in proportion.
 */
export async function createReturn(ctx: Ctx, raw: ReturnInput) {
  distAuthorize(ctx, "bill");
  const i = returnSchema.parse(raw);
  return db.$transaction(async (tx) => {
    await lockKey(tx, "dist_invoice:" + i.invoiceId);
    const inv = await tx.distInvoice.findFirst({ where: { id: i.invoiceId, tenantId: ctx.tenantId }, include: { lines: true } });
    if (!inv) throw new UserError("Invoice not found.");
    if (!ctx.branches.some((b) => b.id === inv.branchId)) throw new UserError("This invoice belongs to a godown you can’t access.");
    if (await tx.distInvoiceCancel.findUnique({ where: { invoiceId: inv.id } })) throw new UserError("This invoice was cancelled.");
    const prior = await tx.distReturnLine.findMany({ where: { invoiceLineId: { in: inv.lines.map((l) => l.id) } } });
    const branch = await tx.branch.findUniqueOrThrow({ where: { id: inv.branchId } });
    const cust = await tx.customer.findUniqueOrThrow({ where: { id: inv.customerId } });
    const meds = await tx.medicine.findMany({ where: { id: { in: inv.lines.map((l) => l.medicineId) } } });
    const seen = new Set<string>();
    const lines = i.lines.map((r) => {
      const l = inv.lines.find((x) => x.id === r.invoiceLineId);
      if (!l) throw new UserError("That line isn’t on this invoice.");
      if (seen.has(l.id)) throw new UserError("A line appears twice."); seen.add(l.id);
      const m = meds.find((x) => x.id === l.medicineId)!;
      const billed = l.qty + l.freeQty, back = prior.filter((p) => p.invoiceLineId === l.id).reduce((a, p) => a + p.qty, 0);
      if (r.qty > billed - back) throw new UserError(`${m.name}: ${billed - back} can still be returned (billed ${billed}, returned ${back}).`);
      const sh = shareOfLine(num(l.taxablePaise), num(l.taxPaise), r.qty, billed);
      const taxable = Math.round((sh.taxable * r.creditPct) / 100), tax = Math.round((sh.tax * r.creditPct) / 100);
      return { r, l, m, taxable, tax };
    });
    const taxable = lines.reduce((a, x) => a + x.taxable, 0), tax = lines.reduce((a, x) => a + x.tax, 0), total = taxable + tax;
    if (total <= 0 && lines.every((x) => x.r.condition === "saleable")) throw new UserError("Nothing to credit.");
    const fy = fiscalYear();
    const no = gstDocNo(seriesOf(branch.code, "C"), fy, await nextSeq(tx, ctx.tenantId, `DCN:${branch.id}:${fy}`), 5);
    const half = Math.floor(tax / 2);
    const v = await postVoucher(tx, {
      tenantId: ctx.tenantId, branchId: branch.id, type: "credit_note", userId: ctx.userId, refType: "dist_return", refId: inv.id, no: `CN-${no}`,
      narration: `${no} · credit note to ${cust.name} against ${inv.no} · ${i.reason}`,
      lines: [
        { account: ACC.salesReturns, dr: taxable },
        ...(inv.igst ? [{ account: ACC.igst, dr: tax }] : [{ account: ACC.cgst, dr: half }, { account: ACC.sgst, dr: tax - half }]),
        { account: ACC.debtors, cr: total, partyType: "customer", partyId: cust.id },
      ],
    });
    const ret = await tx.distReturn.create({
      data: {
        tenantId: ctx.tenantId, branchId: branch.id, no, invoiceId: inv.id, customerId: cust.id, reason: i.reason, taxablePaise: BigInt(taxable), taxPaise: BigInt(tax), totalPaise: BigInt(total), voucherId: v.id, createdBy: ctx.userId,
        lines: { create: lines.map((x) => ({ invoiceLineId: x.l.id, batchId: x.l.batchId, qty: x.r.qty, condition: x.r.condition, creditPct: x.r.creditPct, taxablePaise: BigInt(x.taxable), taxPaise: BigInt(x.tax) })) },
      },
    });
    for (const x of lines) {
      const units = x.r.qty * Math.max(1, x.m.packSize);
      const b = await lockBatch(tx, ctx, x.l.batchId);
      const sellable = x.r.condition === "saleable" && daysTo(b.expiryDate) > 0;
      await tx.batch.update({ where: { id: b.id }, data: sellable ? { qtyAvailable: { increment: units }, version: { increment: 1 } } : { qtyQuarantined: { increment: units }, version: { increment: 1 } } });
      await tx.stockMovement.create({ data: { tenantId: ctx.tenantId, branchId: branch.id, batchId: b.id, qty: units, type: sellable ? "return" : "quarantine", refType: "dist_return", refId: ret.id, userId: ctx.userId, note: `${no} · ${RETURN_CONDITIONS[x.r.condition]}` } });
    }
    await audit(tx, ctx, "Credit note issued", "dist_return", ret.id, `${no} · ${cust.name} · against ${inv.no} · ₹${(total / 100).toFixed(2)} · ${i.reason}`);
    return { returnId: ret.id, no, total };
  });
}

export async function listReturns(ctx: Ctx) {
  distView(ctx, "bill", "reports");
  const rows = await db.distReturn.findMany({ where: { tenantId: ctx.tenantId, branchId: { in: ctx.branches.map((b) => b.id) } }, orderBy: { at: "desc" }, take: 200, include: { lines: true } });
  const [custs, invs] = await Promise.all([
    db.customer.findMany({ where: { id: { in: rows.map((r) => r.customerId) } }, select: { id: true, name: true } }),
    db.distInvoice.findMany({ where: { id: { in: rows.map((r) => r.invoiceId) } }, select: { id: true, no: true } }),
  ]);
  return rows.map((r) => ({ id: r.id, no: r.no, at: r.at, customer: custs.find((c) => c.id === r.customerId)?.name ?? "—", invoiceNo: invs.find((x) => x.id === r.invoiceId)?.no ?? "—", total: num(r.totalPaise), reason: r.reason, packs: r.lines.reduce((a, l) => a + l.qty, 0), toClaims: r.lines.filter((l) => l.condition !== "saleable").reduce((a, l) => a + l.qty, 0) }));
}

// ───────────── Expiry and supplier claims ─────────────

async function policyFor(tenantId: string, medicineIds: string[]) {
  const dps = await db.distProduct.findMany({ where: { tenantId, medicineId: { in: medicineIds } }, select: { medicineId: true, principalId: true } });
  const ps = await db.distPrincipal.findMany({ where: { tenantId, id: { in: dps.map((d) => d.principalId).filter((x): x is string => !!x) } } });
  return (medicineId: string): { policy: ClaimPolicy; principalId: string | null; supplierId: string | null } => {
    const p = ps.find((x) => x.id === dps.find((d) => d.medicineId === medicineId)?.principalId);
    return p ? { policy: { claimBeforeDays: p.claimBeforeDays, claimAfterDays: p.claimAfterDays, claimCreditPct: num(p.claimCreditPct) }, principalId: p.id, supplierId: p.supplierId } : { policy: DEFAULT_POLICY, principalId: null, supplierId: null };
  };
}

/**
 * Expiry workbench for a godown: every batch with stock (on the shelf or quarantined from returns) expiring within
 * `days`, its band, whether its principal takes it back now, and the credit to expect.
 */
export async function expiryWorkbench(ctx: Ctx, days = 180, branchId = ctx.branchId) {
  distView(ctx, "purchase", "adjust", "reports");
  const until = new Date(Date.now() + days * 86400000);
  const batches = await db.batch.findMany({ where: { tenantId: ctx.tenantId, branchId, expiryDate: { lte: until }, OR: [{ qtyAvailable: { gt: 0 } }, { qtyQuarantined: { gt: 0 } }] }, include: { medicine: true, supplier: true }, orderBy: { expiryDate: "asc" }, take: 1000 });
  const pol = await policyFor(ctx.tenantId, [...new Set(batches.map((b) => b.medicineId))]);
  const companies = new Map((await db.distCompany.findMany({ where: { tenantId: ctx.tenantId } })).map((c) => [c.id, c.name]));
  const dps = new Map((await db.distProduct.findMany({ where: { tenantId: ctx.tenantId, medicineId: { in: batches.map((b) => b.medicineId) } } })).map((d) => [d.medicineId, d]));
  return batches.map((b) => {
    const left = daysTo(b.expiryDate), p = pol(b.medicineId), el = claimEligibility(left, p.policy);
    const units = b.qtyAvailable + b.qtyQuarantined, pack = Math.max(1, b.medicine.packSize);
    const value = Math.round((units / pack) * num(b.costPaise));
    return {
      batchId: b.id, medicine: b.medicine.name, company: companies.get(dps.get(b.medicineId)?.companyId ?? "") ?? b.medicine.manufacturer, batchNo: b.batchNo, expiry: isoOf(b.expiryDate), daysLeft: left, band: expiryBand(left),
      onShelf: b.qtyAvailable / pack, quarantined: b.qtyQuarantined / pack, value, supplier: b.supplier?.name ?? null, supplierId: b.supplierId ?? p.supplierId,
      eligible: el.eligible && !!(b.supplierId ?? p.supplierId), why: !(b.supplierId ?? p.supplierId) ? "No supplier on record for this batch." : el.reason, expectedCredit: expectedCredit(value, p.policy), creditPct: p.policy.claimCreditPct,
    };
  });
}

export const claimSchema = z.object({ batchId: zId(), qty: z.coerce.number().int().min(1, "Enter the packs to claim."), reason: z.enum(["expiry", "near_expiry", "breakage"]), note: z.string().trim().max(200).default("") });

/**
 * Raises an expiry / breakage claim on the principal from a batch's quarantined stock (returns from chemists)
 * first, then shelf stock. Checks the principal's return window. The claim is a normal SupplierClaim, so
 * acknowledgement, credit notes, write-offs and reconciliation use the shared claims service.
 */
export async function raiseDistClaim(ctx: Ctx, raw: z.input<typeof claimSchema>) {
  distAuthorize(ctx, "purchase");
  const i = claimSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const b = await lockBatch(tx, ctx, i.batchId);
    if (b.branchId !== ctx.branchId) throw new UserError("Claim stock from the godown that holds it.");
    const p = (await policyFor(ctx.tenantId, [b.medicineId]))(b.medicineId);
    const supplierId = b.supplierId ?? p.supplierId;
    if (!supplierId) throw new UserError("This batch has no supplier on record. Link the principal to its supplier under Principals.");
    const supplier = await tx.supplier.findFirstOrThrow({ where: { id: supplierId, tenantId: ctx.tenantId } });
    if (i.reason !== "breakage") {
      const el = claimEligibility(daysTo(b.expiryDate), p.policy);
      if (!el.eligible) throw new UserError(el.reason);
    }
    const pack = Math.max(1, b.medicine.packSize), units = i.qty * pack;
    if (units > b.qtyAvailable + b.qtyQuarantined) throw new UserError(`Only ${(b.qtyAvailable + b.qtyQuarantined) / pack} packs of this batch are here.`);
    const fromQ = Math.min(units, b.qtyQuarantined), fromShelf = units - fromQ;
    const { taxable, gst, igst } = await returnValue(tx, ctx, b, supplier, units);
    const fy = fiscalYear();
    const no = `CLM-${fy}-${pad(await nextSeq(tx, ctx.tenantId, "CLM:" + fy))}`;
    const why = `${i.reason === "expiry" ? "Expired" : i.reason === "near_expiry" ? "Near expiry" : "Breakage"}${i.note ? " · " + i.note : ""}`;
    await tx.batch.update({ where: { id: b.id }, data: { qtyQuarantined: { decrement: fromQ }, qtyAvailable: { decrement: fromShelf }, version: { increment: 1 } } });
    const so = await tx.stockOut.create({ data: { tenantId: ctx.tenantId, branchId: ctx.branchId, no, kind: "supplier_claim", supplierId, batchId: b.id, qty: units, valuePaise: BigInt(taxable + gst), reason: why, userId: ctx.userId } });
    await tx.stockMovement.create({ data: { tenantId: ctx.tenantId, branchId: ctx.branchId, batchId: b.id, qty: -units, type: "supplier_return", refType: "stock_out", refId: so.id, userId: ctx.userId, note: `${no} · claim · ${why}${fromQ ? ` · ${fromQ / pack} from returns` : ""}` } });
    await postVoucher(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, type: "debit_note", userId: ctx.userId, refType: "supplier_claim", refId: so.id,
      narration: `${no} · claim on ${supplier.name} · ${b.medicine.name} ${b.batchNo} × ${i.qty} · ${why}`,
      lines: [{ account: ACC.claims, dr: taxable + gst }, { account: ACC.purchases, cr: taxable }, ...gstReversal(gst, igst)] });
    const c = await tx.supplierClaim.create({ data: { tenantId: ctx.tenantId, branchId: ctx.branchId, no, supplierId, batchId: b.id, stockOutId: so.id, qty: units, reason: i.reason, note: i.note || null, status: "raised", claimPaise: BigInt(taxable + gst), raisedBy: ctx.userId } });
    await audit(tx, ctx, `Claim raised ${no}`, "supplier_claim", c.id, `${b.medicine.name} ${b.batchNo} × ${i.qty} → ${supplier.name} · ₹${((taxable + gst) / 100).toFixed(2)} · expected credit ${p.policy.claimCreditPct}% · ${why}`);
    return { claimId: c.id, no, value: taxable + gst, expected: expectedCredit(taxable + gst, p.policy) };
  });
}

/** Claim reconciliation: what was claimed, credited, written off and still open, per supplier, with ages. */
export async function claimReconciliation(ctx: Ctx) {
  distView(ctx, "purchase", "payments", "reports");
  const claims = await db.supplierClaim.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { raisedAt: "desc" }, take: 2000 });
  const sups = new Map((await db.supplier.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } })).map((s) => [s.id, s.name]));
  const batches = new Map((await db.batch.findMany({ where: { id: { in: claims.map((c) => c.batchId) } }, include: { medicine: { select: { name: true, packSize: true } } } })).map((b) => [b.id, b]));
  const rows = claims.map((c) => {
    const open = num(c.claimPaise) - num(c.creditPaise) - num(c.writeOffPaise);
    const b = batches.get(c.batchId);
    return { id: c.id, no: c.no, supplier: sups.get(c.supplierId) ?? "—", supplierId: c.supplierId, item: b ? `${b.medicine.name} ${b.batchNo}` : "—", packs: b ? c.qty / Math.max(1, b.medicine.packSize) : c.qty, reason: c.reason, status: c.status, raisedAt: c.raisedAt, ageDays: Math.floor((Date.now() - c.raisedAt.getTime()) / 86400000), claim: num(c.claimPaise), credited: num(c.creditPaise), writtenOff: num(c.writeOffPaise), open: Math.max(0, open) };
  });
  const bySupplier = new Map<string, { supplier: string; claims: number; claimed: number; credited: number; writtenOff: number; open: number; oldestOpenDays: number }>();
  for (const r of rows) {
    const s = bySupplier.get(r.supplierId) ?? { supplier: r.supplier, claims: 0, claimed: 0, credited: 0, writtenOff: 0, open: 0, oldestOpenDays: 0 };
    s.claims++; s.claimed += r.claim; s.credited += r.credited; s.writtenOff += r.writtenOff; s.open += r.open;
    if (r.open > 0) s.oldestOpenDays = Math.max(s.oldestOpenDays, r.ageDays);
    bySupplier.set(r.supplierId, s);
  }
  return { rows, suppliers: [...bySupplier.values()].sort((a, b) => b.open - a.open), today: todayISO() };
}
