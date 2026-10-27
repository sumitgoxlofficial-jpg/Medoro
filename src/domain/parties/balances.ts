import "server-only";
import type { DbOrTx } from "@/server/db";
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

/** Supplier payable (credit balance on Sundry creditors), in paise. */
export async function supplierBalances(tx: DbOrTx, tenantId: string): Promise<Map<string, number>> {
  const r = await tx.$queryRaw<{ id: string; bal: bigint }[]>`
    SELECT l."partyId" AS id, SUM(l."creditPaise" - l."debitPaise") AS bal FROM "LedgerLine" l JOIN "Voucher" v ON v.id = l."voucherId"
    WHERE v."tenantId" = ${tenantId} AND l.account = ${ACC.creditors} AND l."partyType" = 'supplier' GROUP BY l."partyId"`;
  return new Map(r.map((x) => [x.id, Number(x.bal)]));
}
