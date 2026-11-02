/**
 * Store updates on WhatsApp from a Drive mode counter (device migration 9).
 *   - Consent to offers on WhatsApp is a history per customer (customerConsent): who recorded it, when and how. The
 *     latest row is the customer's choice; a STOP reply comes back as a "withdrawn" row.
 *   - A campaign keeps its text; each recipient's result is a campaignSend row. The latest row per customer counts:
 *     sent, opted out and not on WhatsApp are final; failed ones are tried again when the owner resumes.
 * Messages go out through Medoro's gateway (comms/counter-send.ts), which checks the opt-out list and keeps nothing.
 */
import { z } from "zod";
import { DriveDB } from "./client";
import { CounterError } from "./pharmacy";

const now = () => new Date().toISOString();
const MOBILE = /^[6-9]\d{9}$/;
const mobile = (p: string | null) => { const d = (p ?? "").replace(/\D/g, "").replace(/^(91|0)(?=\d{10}$)/, ""); return MOBILE.test(d) ? d : null; };
const FINAL = ["sent", "opted_out", "not_on_whatsapp"];

export const consentInput = z.object({
  customerId: z.string().min(1), granted: z.boolean(), userId: z.string().min(1),
  /** How the customer agreed or withdrew, e.g. "Asked at the counter", "Replied STOP on WhatsApp". */
  method: z.string().trim().min(3).max(80),
});

/** Records that a customer agreed to (or no longer wants) offers on WhatsApp. Nothing is written if it doesn't change. */
export function setOffersConsent(db: DriveDB, input: z.input<typeof consentInput>) {
  const c = consentInput.parse(input);
  if (!db.engine.all("SELECT 1 FROM customer WHERE id = ? AND deletedAt IS NULL", [c.customerId]).length) throw new CounterError("Customer not found.");
  if (c.granted && !mobile(db.engine.all<{ phone: string | null }>("SELECT phone FROM customer WHERE id = ?", [c.customerId])[0]?.phone ?? null)) throw new CounterError("Add the customer’s 10-digit mobile number first.");
  if (offersConsent(db, c.customerId).granted === c.granted) return offersConsent(db, c.customerId);
  db.transaction(() => { db.from("customerConsent").insert({ customerId: c.customerId, purpose: "offers", channel: "whatsapp", granted: c.granted ? 1 : 0, method: c.method, userId: c.userId, at: now() }); });
  return offersConsent(db, c.customerId);
}

/** A customer's current choice about offers on WhatsApp (no record: not agreed). */
export function offersConsent(db: DriveDB, customerId: string) {
  const r = db.engine.all<{ granted: number; method: string; at: string }>(
    "SELECT granted, method, at FROM customerConsent WHERE customerId = ? AND purpose = 'offers' AND channel = 'whatsapp' ORDER BY at DESC, id DESC LIMIT 1", [customerId])[0];
  return r ? { granted: !!r.granted, method: r.method, at: r.at } : { granted: false, method: null, at: null };
}

/** Customers a store update may go to: agreed to offers on WhatsApp (latest choice), with a valid mobile. */
export function campaignAudience(db: DriveDB) {
  return db.engine.all<{ id: string; name: string; phone: string | null; granted: number; at: string }>(
    `SELECT c.id, c.name, c.phone, k.granted, k.at FROM customer c
       JOIN customerConsent k ON k.id = (SELECT id FROM customerConsent WHERE customerId = c.id AND purpose = 'offers' AND channel = 'whatsapp' ORDER BY at DESC, id DESC LIMIT 1)
      WHERE c.deletedAt IS NULL AND k.granted = 1 ORDER BY c.id`)
    .flatMap((c) => { const phone = mobile(c.phone); return phone ? [{ id: c.id, name: c.name, phone, consentAt: c.at }] : []; });
}

export const campaignInput = z.object({
  name: z.string().trim().min(3, "Name the update.").max(60),
  message: z.string().transform((s) => s.replace(/\s+/g, " ").trim()).pipe(z.string().min(3, "Write the update.").max(300, "Keep the update under 300 characters.")),
  userId: z.string().min(1),
});

/** Saves a store update to send. Its audience is counted now; who gets it is decided as it goes out. */
export function createCampaign(db: DriveDB, input: z.input<typeof campaignInput>) {
  const c = campaignInput.parse(input);
  const audience = campaignAudience(db).length;
  if (!audience) throw new CounterError("No customer has agreed to offers on WhatsApp yet. Record their consent under Customers first.");
  return db.transaction(() => db.from<{ id: string }>("campaign").insert({ name: c.name, message: c.message, audience, userId: c.userId, at: now() })[0].id);
}

/**
 * The next people to send a campaign to: in the audience, not yet sent (or opted out / not on WhatsApp). `skip` holds
 * the ones already tried in this run, so a failure isn't retried until the owner resumes.
 */
export function campaignPending(db: DriveDB, campaignId: string, limit = 25, skip: string[] = []) {
  const tried = new Set(skip);
  return pendingAll(db, campaignId).filter((c) => !tried.has(c.id)).slice(0, Math.max(1, Math.min(100, limit)));
}

function pendingAll(db: DriveDB, campaignId: string) {
  const done = new Set(db.engine.all<{ customerId: string; status: string }>(
    `SELECT s.customerId, s.status FROM campaignSend s
      WHERE s.campaignId = ? AND s.id = (SELECT id FROM campaignSend WHERE campaignId = s.campaignId AND customerId = s.customerId ORDER BY at DESC, id DESC LIMIT 1)`, [campaignId])
    .filter((r) => FINAL.includes(r.status)).map((r) => r.customerId));
  return campaignAudience(db).filter((c) => !done.has(c.id));
}

export type SendResult = { id: string; status: "sent" | "failed" | "opted_out" | "not_on_whatsapp"; error?: string };

/** Records what Medoro answered for a batch. An opt-out also withdraws the customer's consent here. */
export function recordCampaignResults(db: DriveDB, campaignId: string, results: SendResult[], userId: string) {
  if (!db.engine.all("SELECT 1 FROM campaign WHERE id = ?", [campaignId]).length) throw new CounterError("Campaign not found.");
  db.transaction(() => {
    for (const r of results) {
      if (!db.engine.all("SELECT 1 FROM customer WHERE id = ?", [r.id]).length) continue;
      db.from("campaignSend").insert({ campaignId, customerId: r.id, status: r.status, error: r.error?.slice(0, 160) ?? null, at: now() });
      if (r.status === "opted_out" && offersConsent(db, r.id).granted) {
        db.from("customerConsent").insert({ customerId: r.id, purpose: "offers", channel: "whatsapp", granted: 0, method: "Replied STOP on WhatsApp", userId, at: now() });
      }
    }
  });
}

/** Store updates sent from the counters, newest first, with how many got each one. */
export function listCampaigns(db: DriveDB, limit = 20) {
  return db.engine.all<{ id: string; name: string; message: string; audience: number; at: string }>("SELECT id, name, message, audience, at FROM campaign ORDER BY at DESC LIMIT ?", [limit])
    .map((c) => {
      const latest = db.engine.all<{ status: string; n: number }>(
        `SELECT s.status, COUNT(*) AS n FROM campaignSend s
          WHERE s.campaignId = ? AND s.id = (SELECT id FROM campaignSend WHERE campaignId = s.campaignId AND customerId = s.customerId ORDER BY at DESC, id DESC LIMIT 1)
          GROUP BY s.status`, [c.id]);
      const n = (k: string) => Number(latest.find((x) => x.status === k)?.n ?? 0);
      return { ...c, sent: n("sent"), failed: n("failed"), optedOut: n("opted_out"), notOnWhatsApp: n("not_on_whatsapp"), pending: pendingAll(db, c.id).length };
    });
}
