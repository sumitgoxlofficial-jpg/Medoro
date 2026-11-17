import "server-only";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { GENESIS, auditHash } from "@/lib/audit-hash";

/**
 * Audit-trail integrity. Every audit event stores the hash of the one before it, so an edited, inserted or removed event breaks
 * the chain from that point. This walks a pharmacy's whole chain in pages (constant memory) and reports the first broken event.
 * The daily job runs it for every pharmacy and records the outcome where Integration Health reads it; nothing is "assumed fine".
 */
const PAGE = 5000;
export type ChainResult = { count: number; ok: boolean; brokenAt: string | null; reason: string | null };

export async function verifyAuditChain(tenantId: string): Promise<ChainResult> {
  let prev = GENESIS, count = 0, cursor: bigint | undefined;
  for (;;) {
    const rows = await db.auditEvent.findMany({ where: { tenantId, ...(cursor !== undefined ? { id: { gt: cursor } } : {}) }, orderBy: { id: "asc" }, take: PAGE });
    if (!rows.length) return { count, ok: true, brokenAt: null, reason: null };
    for (const r of rows) {
      if (r.prevHash !== prev) return { count, ok: false, brokenAt: String(r.id), reason: "The link to the previous event doesn’t match: an event before this one was changed or removed." };
      if (auditHash(prev, { tenantId: r.tenantId, userId: r.userId, action: r.action, entity: r.entity, entityId: r.entityId, detail: r.detail, at: r.at.toISOString() }) !== r.hash) return { count, ok: false, brokenAt: String(r.id), reason: "This event’s content doesn’t match its stored hash: it was edited." };
      prev = r.hash; count++;
    }
    cursor = rows[rows.length - 1].id;
  }
}

/** Verifies one pharmacy's chain and stores the outcome where Integration Health reads it (key "audit_integrity"). A failure is also written to the audit trail. */
export async function recordAuditCheck(tenantId: string, now = new Date()) {
  const r = await verifyAuditChain(tenantId).catch((e) => ({ count: 0, ok: false, brokenAt: null as string | null, reason: `The check could not run: ${e instanceof Error ? e.message : String(e)}`.slice(0, 200) }));
  const lastError = r.ok ? null : `${r.brokenAt ? `Event #${r.brokenAt}: ` : ""}${r.reason}`;
  await db.integrationHealth.upsert({
    where: { tenantId_key: { tenantId, key: "audit_integrity" } },
    create: { tenantId, key: "audit_integrity", lastTestAt: now, lastTestOk: r.ok, lastSuccessAt: r.ok ? now : null, lastError, lastErrorAt: r.ok ? null : now, detail: r.ok ? `${r.count} events verified` : null },
    update: { lastTestAt: now, lastTestOk: r.ok, ...(r.ok ? { lastSuccessAt: now, lastError: null, lastErrorAt: null, detail: `${r.count} events verified` } : { lastError, lastErrorAt: now }) },
  });
  if (!r.ok) await writeAudit(db, { tenantId, userId: null, userName: "System", action: "Audit integrity check FAILED", entity: "audit", entityId: r.brokenAt, detail: r.reason });
  return r;
}
