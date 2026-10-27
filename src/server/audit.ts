import { GENESIS, auditHash } from "@/lib/audit-hash";
import type { DbOrTx, Tx } from "./db";

export type AuditInput = {
  tenantId: string; branchId?: string | null; userId?: string | null; userName?: string | null;
  action: string; entity: string; entityId?: string | null; detail?: string | null;
  before?: unknown; after?: unknown; ip?: string | null;
};

/**
 * Append a hash-chained audit event. Takes a per-tenant advisory lock so the chain
 * stays linear under concurrent writers; call inside the business transaction.
 */
export async function writeAudit(client: DbOrTx, a: AuditInput): Promise<unknown> {
  // The advisory lock only lasts for a transaction, so open one when given the root client.
  if ("$transaction" in client) return client.$transaction((tx) => writeAudit(tx, a));
  const tx = client as Tx;
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"audit:" + a.tenantId}))`;
  const last = await tx.auditEvent.findFirst({ where: { tenantId: a.tenantId }, orderBy: { id: "desc" }, select: { hash: true } });
  const prevHash = last?.hash ?? GENESIS;
  const at = new Date();
  const hash = auditHash(prevHash, { tenantId: a.tenantId, userId: a.userId, action: a.action, entity: a.entity, entityId: a.entityId, detail: a.detail, at: at.toISOString() });
  return tx.auditEvent.create({
    data: {
      tenantId: a.tenantId, branchId: a.branchId ?? null, userId: a.userId ?? null, userName: a.userName ?? null,
      action: a.action, entity: a.entity, entityId: a.entityId ?? null, detail: a.detail ?? null,
      before: (a.before ?? undefined) as never, after: (a.after ?? undefined) as never, ip: a.ip ?? null,
      at, prevHash, hash,
    },
  });
}
