import "server-only";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorize, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { todayISO } from "@/lib/dates";
import { big, inr } from "@/lib/money";
import { postVoucher } from "@/domain/accounting/post";
import { lockOpenShift } from "./returns";
import { adjustPointsForReturn } from "./loyalty";

/**
 * Cancels today's bill in full. Nothing is edited: stock goes back to the same batches, the sales
 * voucher is reversed line for line (so each payment mode is refunded and credit comes off the
 * customer's balance), and an append-only void record marks the sale. Older bills need a credit note.
 */
export async function voidSale(ctx: Ctx, saleId: string, rawReason: string) {
  authorize(ctx, "refund");
  const reason = rawReason.trim();
  if (reason.length < 3) throw new UserError("Enter the reason for voiding this bill.");
  return db.$transaction(async (tx) => {
    const locked = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "SaleItem" WHERE "saleId" = ${saleId} FOR UPDATE`;
    const sale = locked.length ? await tx.sale.findFirst({ where: { id: saleId, tenantId: ctx.tenantId }, include: { items: true, payments: true, customer: true, voided: true } }) : null;
    if (!sale) throw new UserError("Invoice not found.");
    if (sale.branchId !== ctx.branchId) throw new UserError("Void bills at the branch that made the sale.");
    if (sale.voided) throw new UserError(`${sale.invoiceNo} is already void.`);
    if (todayISO(sale.at) !== todayISO()) throw new UserError("Only today’s bills can be voided. Issue a credit note (return) for older bills.");
    if (sale.items.some((i) => i.returnedQty > 0)) throw new UserError("Part of this bill was already returned. Return the rest with a credit note instead.");
    const orig = await tx.voucher.findFirst({ where: { tenantId: ctx.tenantId, refType: "sale", refId: sale.id, reversesId: null }, include: { lines: true } });
    if (!orig) throw new UserError("This bill’s accounting entry is missing; it can’t be voided automatically.");

    for (const it of sale.items) {
      await tx.saleItem.update({ where: { id: it.id }, data: { returnedQty: it.qty } });
      await tx.batch.update({ where: { id: it.batchId }, data: { qtyAvailable: { increment: it.qty }, version: { increment: 1 } } });
    }
    await tx.stockMovement.createMany({ data: sale.items.map((it) => ({ tenantId: ctx.tenantId, branchId: sale.branchId, batchId: it.batchId, qty: it.qty, type: "void", refType: "sale_void", refId: sale.id, userId: ctx.userId, note: `Void of ${sale.invoiceNo}` })) });

    const refunds = sale.payments.map((p) => ({ mode: p.mode, amountPaise: big(p.amountPaise) }));
    const cash = refunds.filter((r) => r.mode === "cash").reduce((a, r) => a + r.amountPaise, 0);
    const shift = await lockOpenShift(tx, ctx);
    const v = await tx.saleVoid.create({ data: { tenantId: ctx.tenantId, branchId: sale.branchId, saleId: sale.id, reason: reason.slice(0, 200), userId: ctx.userId, shiftId: shift?.id ?? null, refunds, cashRefundPaise: BigInt(cash) } });
    // Earned points are taken back and redeemed ones given back in full.
    const base = sale.items.reduce((a, it) => a + big(it.mrpPaise) * it.qty - big(it.discountPaise), 0);
    await adjustPointsForReturn(tx, ctx, sale, v.id, `Void of ${sale.invoiceNo}`, base, base);
    await postVoucher(tx, {
      tenantId: ctx.tenantId, branchId: sale.branchId, type: "reversal", userId: ctx.userId, refType: "sale_void", refId: v.id, reversesId: orig.id,
      narration: `Void of ${sale.invoiceNo}${sale.customer ? " · " + sale.customer.name : ""} · ${reason.slice(0, 120)}`,
      lines: orig.lines.map((l) => ({ account: l.account, dr: big(l.creditPaise), cr: big(l.debitPaise), ...(l.partyType ? { partyType: l.partyType as "customer", partyId: l.partyId! } : {}) })),
    });
    const how = refunds.map((r) => `${r.mode === "credit" ? "credit cleared" : r.mode.toUpperCase()} ${inr(r.amountPaise)}`).join(" + ");
    await writeAudit(tx, { tenantId: ctx.tenantId, branchId: sale.branchId, userId: ctx.userId, userName: ctx.userName, action: "Sale voided", entity: "sale", entityId: sale.id, detail: `${sale.invoiceNo} · ${inr(big(sale.totalPaise))} · ${how} · ${reason.slice(0, 120)}` });
    return { invoiceNo: sale.invoiceNo, amount: big(sale.totalPaise), refunds };
  });
}
