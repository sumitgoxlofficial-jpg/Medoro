import "server-only";
import { createHmac } from "node:crypto";
import { db } from "@/server/db";

/**
 * WhatsApp opt-outs for Drive mode pharmacies. Their customers live on the counters, not on Medoro's server, so a STOP
 * reply that reaches Medoro (Meta's webhook) has no customer row to update. Medoro keeps a keyed hash of the number
 * instead, and a campaign sent from a counter skips any number on the list (and tells the counter, which records the
 * withdrawal on the customer). A 10-digit number is easy to guess from a plain hash, so the hash is keyed from HOST_KEY.
 * A linked phone keeps its own STOP list on the link (embedded.ts / the connector), which refuses those sends too.
 */
const key = (tenantId: string) => createHmac("sha256", process.env.HOST_KEY || process.env.SESSION_SECRET || "").update("medoro-wa-optout:" + tenantId).digest();
export const optOutHash = (tenantId: string, phone10: string) => createHmac("sha256", key(tenantId)).update(phone10.replace(/\D/g, "").slice(-10)).digest("base64url");

export async function recordOptOut(tenantId: string, phone10: string) {
  await db.waOptOut.upsert({ where: { tenantId_phoneHash: { tenantId, phoneHash: optOutHash(tenantId, phone10) } }, create: { tenantId, phoneHash: optOutHash(tenantId, phone10) }, update: {} });
}

/** Fresh consent recorded at the counter after the STOP lifts it. */
export async function clearOptOut(tenantId: string, phone10: string) {
  await db.waOptOut.deleteMany({ where: { tenantId, phoneHash: optOutHash(tenantId, phone10) } });
}

/** Which of these 10-digit numbers opted out, and when. */
export async function optedOut(tenantId: string, phones: string[]): Promise<Map<string, Date>> {
  if (!phones.length) return new Map();
  const byHash = new Map(phones.map((p) => [optOutHash(tenantId, p), p]));
  const rows = await db.waOptOut.findMany({ where: { tenantId, phoneHash: { in: [...byHash.keys()] } }, select: { phoneHash: true, createdAt: true } });
  return new Map(rows.map((r) => [byHash.get(r.phoneHash)!, r.createdAt]));
}
