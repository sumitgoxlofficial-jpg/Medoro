import "server-only";
import { z } from "zod";
import { db, type Tx } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorize, authorizeAny, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { nextSeq, pad } from "@/server/sequence";
import { addDays, dateOnly, daysTo, fiscalYear, isoOf, todayISO } from "@/lib/dates";
import { big, inr } from "@/lib/money";
import { postVoucher } from "@/domain/accounting/post";
import { ACC } from "@/domain/accounting/accounts";
import { allocateToBills } from "@/domain/parties/balances";
import { gstReversal, lockBatch, returnValue } from "./adjust";

import { CLAIM_REASONS, CLAIM_STATUS, type ClaimReason } from "./claim-types";
export { CLAIM_REASONS, CLAIM_STATUS, type ClaimReason };

const raiseSchema = z.object({
  batchId: z.string().uuid(),
  qty: z.coerce.number().int().min(1, "Enter a quantity."),
  reason: z.enum(Object.keys(CLAIM_REASONS) as [ClaimReason, ...ClaimReason[]], { message: "Choose why the stock goes back." }),
  note: z.string().trim().max(200).default(""),
});

/**
 * Sends stock back to the supplier as a claim. Stock leaves now and its cost moves from Purchases (and input GST)
 * to Supplier claims receivable; the supplier payable is reduced only when their credit note is recorded.
 */
export async function raiseClaim(ctx: Ctx, raw: z.input<typeof raiseSchema>) {
  authorize(ctx, "purchase");
  const i = raiseSchema.parse(raw);
  return db.$transaction(async (tx) => {
    const b = await lockBatch(tx, ctx, i.batchId);
    if (b.branchId !== ctx.branchId) throw new UserError("Claim stock from the branch that holds it.");
    if (!b.supplier) throw new UserError("This batch has no supplier on record (opening stock). Write it off instead.");
    if (!b.supplier.acceptsReturns && (i.reason === "expiry" || i.reason === "near_expiry")) throw new UserError(`${b.supplier.name} doesn’t accept expiry returns.`);
    if (i.qty > b.qtyAvailable) throw new UserError(`Only ${b.qtyAvailable} in stock.`);
    const { taxable, gst, igst } = await returnValue(tx, ctx, b, b.supplier, i.qty);
    const fy = fiscalYear();
    const no = `CLM-${fy}-${pad(await nextSeq(tx, ctx.tenantId, "CLM:" + fy))}`;
    const why = `${CLAIM_REASONS[i.reason]}${i.note ? " · " + i.note : ""}`;
    await tx.batch.update({ where: { id: b.id }, data: { qtyAvailable: { decrement: i.qty }, version: { increment: 1 } } });
    const so = await tx.stockOut.create({ data: { tenantId: ctx.tenantId, branchId: ctx.branchId, no, kind: "supplier_claim", supplierId: b.supplier.id, batchId: b.id, qty: i.qty, valuePaise: BigInt(taxable + gst), reason: why, userId: ctx.userId } });
    await tx.stockMovement.create({ data: { tenantId: ctx.tenantId, branchId: ctx.branchId, batchId: b.id, qty: -i.qty, type: "supplier_return", refType: "stock_out", refId: so.id, userId: ctx.userId, note: `${no} · claim · ${why}` } });
    await postVoucher(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, type: "debit_note", userId: ctx.userId, refType: "supplier_claim", refId: so.id,
      narration: `${no} · claim on ${b.supplier.name} · ${b.medicine.name} ${b.batchNo} × ${i.qty} · ${CLAIM_REASONS[i.reason]}`,
      lines: [{ account: ACC.claims, dr: taxable + gst }, { account: ACC.purchases, cr: taxable }, ...gstReversal(gst, igst)] });
    const c = await tx.supplierClaim.create({ data: { tenantId: ctx.tenantId, branchId: ctx.branchId, no, supplierId: b.supplier.id, batchId: b.id, stockOutId: so.id, qty: i.qty, reason: i.reason, note: i.note || null, status: "raised", claimPaise: BigInt(taxable + gst), raisedBy: ctx.userId } });
    await writeAudit(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: `Claim raised ${no}`, entity: "supplier_claim", entityId: c.id, detail: `${b.medicine.name} ${b.batchNo} × ${i.qty} → ${b.supplier.name} · ${inr(taxable + gst)} · ${why}` });
    return no;
  });
}

async function lockClaim(tx: Tx, ctx: Ctx, id: string) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"claim:" + id}))`;
  const c = await tx.supplierClaim.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!c) throw new UserError("Claim not found.");
  return c;
}

export async function acknowledgeClaim(ctx: Ctx, id: string) {
  authorize(ctx, "purchase");
  return db.$transaction(async (tx) => {
    const c = await lockClaim(tx, ctx, id);
    if (c.status !== "raised") throw new UserError(`${c.no} is already ${CLAIM_STATUS[c.status as keyof typeof CLAIM_STATUS]?.toLowerCase() ?? c.status}.`);
    await tx.supplierClaim.update({ where: { id }, data: { status: "acknowledged", ackAt: new Date() } });
    await writeAudit(tx, { tenantId: ctx.tenantId, branchId: c.branchId, userId: ctx.userId, userName: ctx.userName, action: "Claim acknowledged", entity: "supplier_claim", entityId: id, detail: c.no });
  });
}

const creditSchema = z.object({
  ref: z.string().trim().max(40).default(""),
  amount: z.union([z.string(), z.number()]).transform((v) => Math.round((parseFloat(String(v === "" ? 0 : v)) || 0) * 100)).refine((p) => p >= 0, "Amount can’t be negative."),
  /** Write off whatever stays unpaid after this credit and close the claim. */
  close: z.boolean().default(false),
  reason: z.string().trim().max(200).default(""),
});
export type ClaimCreditInput = z.input<typeof creditSchema>;

/**
 * Records the supplier's credit note against a claim (partial credits allowed). The credit reduces the payable
 * and clears the claim receivable; any excess over the claim is a recovery on Claim write-off. Closing writes off
 * what is still open to Claim write-off with a reason; a claim closed with no credit at all is rejected.
 */
export async function creditClaim(ctx: Ctx, id: string, raw: ClaimCreditInput) {
  authorize(ctx, "purchase");
  const i = creditSchema.parse(raw);
  if (i.amount > 0 && i.ref.length < 1) throw new UserError("Enter the supplier’s credit note number.");
  if (!i.amount && !i.close) throw new UserError("Enter the credit amount.");
  return db.$transaction(async (tx) => {
    const c = await lockClaim(tx, ctx, id);
    if (c.status === "credited" || c.status === "rejected") throw new UserError(`${c.no} is already closed.`);
    const s = await tx.supplier.findFirstOrThrow({ where: { id: c.supplierId } });
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"party:" + s.id}))`;
    const open = big(c.claimPaise) - big(c.creditPaise) - big(c.writeOffPaise);
    const credits = (c.credits as { ref: string; amount: number; at: string; voucherNo: string }[]) ?? [];
    let creditNo = "";
    if (i.amount) {
      const applied = Math.min(i.amount, open);
      const v = await postVoucher(tx, { tenantId: ctx.tenantId, branchId: c.branchId, type: "journal", userId: ctx.userId, refType: "claim_credit", refId: c.id,
        narration: `Credit note ${i.ref} from ${s.name} against ${c.no}`,
        lines: [{ account: ACC.creditors, dr: i.amount, partyType: "supplier", partyId: s.id }, { account: ACC.claims, cr: applied }, { account: ACC.claimLoss, cr: i.amount - applied }] });
      await allocateToBills(tx, ctx.tenantId, s.id, i.amount);
      credits.push({ ref: i.ref, amount: i.amount, at: new Date().toISOString(), voucherNo: v.no });
      creditNo = v.no;
    }
    const left = open - Math.min(i.amount, open);
    const closing = i.close && left > 0;
    if (closing && i.reason.length < 3) throw new UserError("Enter why the rest of the claim is written off.");
    if (closing) await postVoucher(tx, { tenantId: ctx.tenantId, branchId: c.branchId, type: "journal", userId: ctx.userId, refType: "claim_writeoff", refId: c.id,
      narration: `${c.no} · ${inr(left)} not credited by ${s.name} · ${i.reason}`, lines: [{ account: ACC.claimLoss, dr: left }, { account: ACC.claims, cr: left }] });
    const credited = big(c.creditPaise) + i.amount;
    const status = left > 0 && !closing ? (c.status === "raised" && i.amount ? "acknowledged" : c.status) : credited > 0 ? "credited" : "rejected";
    await tx.supplierClaim.update({ where: { id }, data: {
      creditPaise: BigInt(credited), credits, status, ackAt: c.ackAt ?? new Date(),
      ...(closing ? { writeOffPaise: { increment: BigInt(left) }, writeOffReason: i.reason } : {}), ...(status === "credited" || status === "rejected" ? { settledAt: new Date() } : {}),
    } });
    await writeAudit(tx, { tenantId: ctx.tenantId, branchId: c.branchId, userId: ctx.userId, userName: ctx.userName, action: status === "rejected" ? "Claim rejected" : i.amount ? "Claim credit recorded" : "Claim closed", entity: "supplier_claim", entityId: id,
      detail: `${c.no}${i.amount ? ` · CN ${i.ref} ${inr(i.amount)} (${creditNo})` : ""}${closing ? ` · written off ${inr(left)} · ${i.reason}` : ""}` });
    return { status, open: closing ? 0 : left };
  });
}

/** Open and recent claims with their age, and an aging summary of what each supplier still owes on claims. */
export async function listClaims(ctx: Ctx) {
  authorizeAny(ctx, "purchase", "payments");
  const claims = await db.supplierClaim.findMany({ where: { tenantId: ctx.tenantId, OR: [{ status: { in: ["raised", "acknowledged"] } }, { settledAt: { gte: new Date(Date.now() - 90 * 86400_000) } }] }, orderBy: { raisedAt: "desc" }, take: 300 });
  const [sups, batches] = await Promise.all([
    db.supplier.findMany({ where: { tenantId: ctx.tenantId, id: { in: [...new Set(claims.map((c) => c.supplierId))] } }, select: { id: true, name: true } }),
    db.batch.findMany({ where: { id: { in: claims.map((c) => c.batchId) } }, select: { id: true, batchNo: true, expiryDate: true, medicine: { select: { name: true } } } }),
  ]);
  const rows = claims.map((c) => {
    const b = batches.find((x) => x.id === c.batchId);
    const open = big(c.claimPaise) - big(c.creditPaise) - big(c.writeOffPaise);
    return {
      id: c.id, no: c.no, supplierId: c.supplierId, supplier: sups.find((s) => s.id === c.supplierId)?.name ?? "", item: b ? `${b.medicine.name} · ${b.batchNo}` : "", expiry: b ? isoOf(b.expiryDate) : "",
      qty: c.qty, reason: c.reason as ClaimReason, status: c.status as keyof typeof CLAIM_STATUS, claim: big(c.claimPaise), credit: big(c.creditPaise), writeOff: big(c.writeOffPaise), open,
      age: -daysTo(c.raisedAt), raisedAt: c.raisedAt.toISOString(), credits: c.credits as { ref: string; amount: number; at: string; voucherNo: string }[], writeOffReason: c.writeOffReason,
    };
  });
  const bucket = (d: number) => (d <= 30 ? 0 : d <= 60 ? 1 : d <= 90 ? 2 : 3);
  const aging = new Map<string, { supplierId: string; supplier: string; count: number; open: number; oldest: number; buckets: [number, number, number, number] }>();
  for (const r of rows.filter((x) => x.status === "raised" || x.status === "acknowledged")) {
    const a = aging.get(r.supplierId) ?? { supplierId: r.supplierId, supplier: r.supplier, count: 0, open: 0, oldest: 0, buckets: [0, 0, 0, 0] };
    a.count++; a.open += r.open; a.oldest = Math.max(a.oldest, r.age); a.buckets[bucket(r.age)] += r.open;
    aging.set(r.supplierId, a);
  }
  return { rows, aging: [...aging.values()].sort((a, b) => b.open - a.open) };
}

/**
 * Batches worth claiming back: stock from suppliers who take returns whose expiry falls within that supplier's
 * return window (already expired stock included), grouped by supplier.
 */
export async function nearExpiryClaims(ctx: Ctx) {
  authorizeAny(ctx, "purchase", "payments");
  const sups = await db.supplier.findMany({ where: { tenantId: ctx.tenantId, acceptsReturns: true }, select: { id: true, name: true, returnWindowDays: true } });
  const maxWindow = Math.max(0, ...sups.map((s) => s.returnWindowDays));
  const batches = await db.batch.findMany({
    where: { tenantId: ctx.tenantId, branchId: ctx.branchId, qtyAvailable: { gt: 0 }, supplierId: { in: sups.map((s) => s.id) }, expiryDate: { lte: dateOnly(addDays(todayISO(), maxWindow)) } },
    include: { medicine: { select: { name: true } } }, orderBy: { expiryDate: "asc" },
  });
  return sups.map((s) => {
    const items = batches.filter((b) => b.supplierId === s.id && daysTo(b.expiryDate) <= s.returnWindowDays).map((b) => ({
      batchId: b.id, item: b.medicine.name, batchNo: b.batchNo, expiry: isoOf(b.expiryDate), days: daysTo(b.expiryDate), qty: b.qtyAvailable, value: b.qtyAvailable * big(b.costPaise),
    }));
    return { supplierId: s.id, supplier: s.name, window: s.returnWindowDays, items, value: items.reduce((a, x) => a + x.value, 0) };
  }).filter((g) => g.items.length).sort((a, b) => b.value - a.value);
}
