import "server-only";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { parseInbound, STOP_WORDS } from "@/server/sms";
import { normPhone } from "@/domain/identity/contracts";

/**
 * Applies an authentic inbound SMS. A STOP keyword withdraws SMS consent for that number in every pharmacy
 * on this server (they share the sender). Returns null for unauthenticated requests, else how many customers opted out.
 */
export async function handleInboundSms(raw: string, headers: Headers) {
  const m = parseInbound(raw, headers);
  if (!m) return null;
  const word = m.text.trim().toUpperCase().split(/\s+/)[0] ?? "";
  if (!STOP_WORDS.includes(word)) return 0;
  const phone = normPhone(m.from);
  const hits = await db.customer.findMany({ where: { phone, smsOptIn: true }, select: { id: true, tenantId: true } });
  for (const c of hits) {
    await db.customer.update({ where: { id: c.id }, data: { smsOptIn: false, smsOptInAt: new Date(), smsOptInMethod: `Opted out by replying ${word} by SMS` } });
    await writeAudit(db, { tenantId: c.tenantId, action: "SMS opt-out", entity: "customer", entityId: c.id, detail: `${phone.slice(0, 5)}••••• replied ${word}` });
  }
  return hits.length;
}
