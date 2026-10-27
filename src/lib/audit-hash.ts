import { createHash } from "node:crypto";

export type AuditPayload = {
  tenantId: string; userId?: string | null; action: string; entity: string;
  entityId?: string | null; detail?: string | null; at: string;
};

/** Each audit row stores sha256(prevHash + canonical payload), forming a tamper-evident chain. */
export function auditHash(prevHash: string, p: AuditPayload): string {
  const canonical = JSON.stringify([p.tenantId, p.userId ?? null, p.action, p.entity, p.entityId ?? null, p.detail ?? null, p.at]);
  return createHash("sha256").update(prevHash + canonical).digest("hex");
}

export const GENESIS = "0".repeat(64);

export function verifyChain(rows: (AuditPayload & { prevHash: string; hash: string })[]): number {
  let prev = GENESIS;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    if (r.prevHash !== prev || auditHash(prev, r) !== r.hash) return i;
    prev = r.hash;
  }
  return -1;
}
