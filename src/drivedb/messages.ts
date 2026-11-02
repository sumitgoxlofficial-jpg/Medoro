/**
 * WhatsApp messages sent from the counters (device migration 10): bills and store updates, with the provider's
 * message id and the latest status Medoro reports (comms/counter-send.ts: counterMessageStatus). The status only
 * moves forward (sent → delivered → read); a failure is kept with its reason.
 */
import { DriveDB } from "./client";

export type MsgStatus = "sent" | "delivered" | "read" | "failed";
const ORDER: MsgStatus[] = ["sent", "delivered", "read"];
const now = () => new Date().toISOString();

export function logMessage(db: DriveDB, m: { kind: "bill" | "campaign"; refId: string; customerId?: string | null; messageId: string }) {
  if (!m.messageId) return null;
  return db.transaction(() => db.from<{ id: string }>("messageLog").insert({ kind: m.kind, refId: m.refId, customerId: m.customerId ?? null, messageId: m.messageId, status: "sent", error: null, sentAt: now() })[0].id);
}

/** Message ids still worth asking about: not read or failed yet, sent in the last 3 days. */
export function openMessageIds(db: DriveDB, at = Date.now(), limit = 200) {
  return db.engine.all<{ messageId: string }>(
    "SELECT DISTINCT messageId FROM messageLog WHERE deletedAt IS NULL AND status IN ('sent', 'delivered') AND sentAt >= ? ORDER BY sentAt DESC LIMIT ?",
    [new Date(at - 3 * 86400_000).toISOString(), limit]).map((r) => r.messageId);
}

/** Applies what Medoro reported, by message id. Returns how many messages changed. */
export function recordStatuses(db: DriveDB, report: Record<string, { status: string; error: string | null }>) {
  let changed = 0;
  db.transaction(() => {
    for (const [messageId, r] of Object.entries(report)) {
      const status = r.status === "queued" ? "sent" : (r.status as MsgStatus);
      if (![...ORDER, "failed"].includes(status)) continue;
      for (const row of db.engine.all<{ id: string; status: MsgStatus }>("SELECT id, status FROM messageLog WHERE messageId = ? AND deletedAt IS NULL", [messageId])) {
        if (row.status === "failed" || row.status === status) continue;
        if (status !== "failed" && ORDER.indexOf(status) <= ORDER.indexOf(row.status)) continue;
        db.from("messageLog").eq("id", row.id).update({ status, error: status === "failed" ? (r.error ?? "Not delivered").slice(0, 160) : null });
        changed++;
      }
    }
  });
  return changed;
}

/** The WhatsApp sends of one bill, newest first. */
export const billMessages = (db: DriveDB, saleId: string) =>
  db.engine.all<{ status: MsgStatus; error: string | null; sentAt: string }>("SELECT status, error, sentAt FROM messageLog WHERE kind = 'bill' AND refId = ? AND deletedAt IS NULL ORDER BY sentAt DESC, rowid DESC", [saleId]);

/** How far a store update got: delivered (or read) and read counts. */
export function campaignDelivery(db: DriveDB, campaignId: string) {
  const r = db.engine.all<{ status: string; n: number }>("SELECT status, COUNT(*) AS n FROM messageLog WHERE kind = 'campaign' AND refId = ? AND deletedAt IS NULL GROUP BY status", [campaignId]);
  const n = (k: string) => Number(r.find((x) => x.status === k)?.n ?? 0);
  return { delivered: n("delivered") + n("read"), read: n("read"), failedAfter: n("failed") };
}
