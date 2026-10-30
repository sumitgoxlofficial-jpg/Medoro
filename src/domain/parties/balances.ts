import "server-only";
import type { DbOrTx, Tx } from "@/server/db";
import { ACC } from "@/domain/accounting/accounts";

/** Customer outstanding (debit balance on Sundry debtors), in paise. */
export async function customerBalance(tx: DbOrTx, tenantId: string, customerId: string): Promise<number> {
  const r = await tx.$queryRaw<{ bal: bigint | null }[]>`
    SELECT SUM(l."debitPaise" - l."creditPaise") AS bal FROM "LedgerLine" l JOIN "Voucher" v ON v.id = l."voucherId"
    WHERE v."tenantId" = ${tenantId} AND l.account = ${ACC.debtors} AND l."partyType" = 'customer' AND l."partyId" = ${customerId}`;
  return Number(r[0]?.bal ?? 0);
}

export async function customerBalances(tx: DbOrTx, tenantId: string): Promise<Map<string, number>> {
  const r = await tx.$queryRaw<{ id: string; bal: bigint }[]>`
    SELECT l."partyId" AS id, SUM(l."debitPaise" - l."creditPaise") AS bal FROM "LedgerLine" l JOIN "Voucher" v ON v.id = l."voucherId"
    WHERE v."tenantId" = ${tenantId} AND l.account = ${ACC.debtors} AND l."partyType" = 'customer' GROUP BY l."partyId"`;
  return new Map(r.map((x) => [x.id, Number(x.bal)]));
}

/**
 * Settles a supplier's open bills with a payment or debit note: the bill for `firstGrnId` first (if any), then
 * oldest due first. Returns the amount that found no open bill. Caller holds the party lock.
 */
export async function allocateToBills(tx: Tx, tenantId: string, supplierId: string, amount: number, firstGrnId?: string | null): Promise<number> {
  const bills = await tx.supplierBill.findMany({ where: { tenantId, supplierId }, orderBy: [{ dueDate: "asc" }, { date: "asc" }] });
  if (firstGrnId) bills.sort((a, b) => Number(b.grnId === firstGrnId) - Number(a.grnId === firstGrnId));
  let left = amount;
  for (const b of bills) {
    const open = Number(b.amountPaise - b.paidPaise);
    if (open <= 0 || left <= 0) continue;
    const take = Math.min(open, left);
    await tx.supplierBill.update({ where: { id: b.id }, data: { paidPaise: { increment: BigInt(take) } } });
    left -= take;
  }
  return left;
}

/** Supplier payable (credit balance on Sundry creditors), in paise. */
export async function supplierBalances(tx: DbOrTx, tenantId: string): Promise<Map<string, number>> {
  const r = await tx.$queryRaw<{ id: string; bal: bigint }[]>`
    SELECT l."partyId" AS id, SUM(l."creditPaise" - l."debitPaise") AS bal FROM "LedgerLine" l JOIN "Voucher" v ON v.id = l."voucherId"
    WHERE v."tenantId" = ${tenantId} AND l.account = ${ACC.creditors} AND l."partyType" = 'supplier' GROUP BY l."partyId"`;
  return new Map(r.map((x) => [x.id, Number(x.bal)]));
}
