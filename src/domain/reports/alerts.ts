import "server-only";
import { db } from "@/server/db";
import { addDays, dateOnly, todayISO } from "@/lib/dates";
import { sellableByMedicine } from "@/domain/inventory/queries";
import { driveState } from "@/domain/system/gdrive";
import { dataInDrive, quotaProblem, type Quota } from "@/domain/system/drive-state";
import type { ScreenId } from "@/lib/nav";

const OVERDUE_MS = 26 * 3600_000;

/** Backup problems the owner should act on: a failed or incomplete last backup, none in 26 hours, lost Drive access. */
export async function backupHealth(tenantId: string, now = new Date()) {
  const real = { tenantId, kind: { not: "imported" } };
  const [tenant, lastOk, last, drive] = await Promise.all([
    db.tenant.findUnique({ where: { id: tenantId }, select: { createdAt: true, settings: true } }),
    db.backupManifest.findFirst({ where: { ...real, status: { in: ["verified", "partial"] } }, orderBy: { startedAt: "desc" } }),
    db.backupManifest.findFirst({ where: { ...real, status: { not: "running" } }, orderBy: { startedAt: "desc" } }),
    driveState(tenantId),
  ]);
  // Data in Drive: Medoro keeps no copy to back up; what matters is that every counter keeps saving to Drive.
  if (dataInDrive(tenant?.settings)) {
    const full = quotaProblem((tenant?.settings as { driveHealth?: { quota?: Quota } } | null)?.driveHealth?.quota);
    return [...(drive.status === "lost" ? ["Google Drive access was lost, so your counters can’t save to it. Reconnect it in Backup & restore."] : []), ...(full ? [full] : []), ...(await driveSyncHealth(tenantId, now))];
  }
  const problems: string[] = [];
  if (last?.status === "failed") problems.push(`Last backup failed: ${last.error ?? "unknown error"}`);
  else if (last?.status === "partial" && last.error) problems.push(`Last backup is incomplete: ${last.error}`);
  const since = lastOk?.startedAt ?? tenant?.createdAt;
  if (since && now.getTime() - since.getTime() > OVERDUE_MS) problems.push(lastOk ? `No successful backup for ${Math.floor((now.getTime() - since.getTime()) / 3600_000)} hours` : "No successful backup yet");
  if (drive.status === "lost") problems.push("Google Drive access was lost. Reconnect it in Backup & restore.");
  return problems;
}

const STALE_SYNC_MS = 3 * 86400_000, RECENT_ERROR_MS = 24 * 3600_000;

/**
 * Drive mode counters that need the owner: one that hasn't saved to Google Drive for 3 days or more (its bills are
 * only on that device), and one whose last sync failed in the past day.
 */
export async function driveSyncHealth(tenantId: string, now = new Date()) {
  const devices = await db.driveDevice.findMany({ where: { tenantId, status: "approved" }, orderBy: { createdAt: "asc" } });
  const out: string[] = [];
  for (const d of devices) {
    const name = d.name.split(" · ")[0] + (d.name.includes(" · ") ? ` (${d.name.split(" · ").slice(1).join(" · ")})` : "");
    if (d.lastError && d.lastErrorAt && now.getTime() - d.lastErrorAt.getTime() < RECENT_ERROR_MS) out.push(`${name} couldn’t sync with Google Drive: ${d.lastError}`);
    const since = d.lastSyncAt ?? d.decidedAt ?? d.createdAt;
    if (now.getTime() - since.getTime() >= STALE_SYNC_MS) {
      const days = Math.floor((now.getTime() - since.getTime()) / 86400_000);
      out.push(d.lastSyncAt ? `${name} hasn’t saved to Google Drive for ${days} days. Open Billing (device) on it while online, or its bills are only on that device.` : `${name} has never saved to Google Drive. Open Billing (device) on it while online.`);
    }
  }
  return out;
}

/** The latest UPI & Bank counts any approved counter reported in the past 3 days (counters share the same data). */
export async function financeCounts(tenantId: string, now = new Date()) {
  const d = await db.driveDevice.findFirst({ where: { tenantId, status: "approved", finAlertsAt: { gte: new Date(now.getTime() - STALE_SYNC_MS) } }, orderBy: { finAlertsAt: "desc" } });
  return d?.finAlerts ? { ...(d.finAlerts as { notSeen: number; review: number; unmatched: number; statementTo: string | null }), at: d.finAlertsAt! } : null;
}

/** UPI & Bank items for the owner's daily email, from the counters' counts. */
export async function financeAlerts(tenantId: string, now = new Date()) {
  const { connectionAlerts } = await import("@/domain/finance/connections");
  const conn = await connectionAlerts(tenantId, now);
  const f = await financeCounts(tenantId, now);
  if (!f) return conn;
  const out: string[] = [];
  if (f.notSeen) out.push(`${f.notSeen} UPI payment(s) taken at the counter are not in your bank statement${f.statementTo ? ` (statements up to ${f.statementTo})` : ""}. A “payment successful” screen isn’t proof: check them under Billing (device) → UPI & Bank → Reconcile.`);
  if (f.review) out.push(`${f.review} bank transaction(s) may be duplicates from overlapping statements. Decide under UPI & Bank → Reconcile.`);
  // Unmatched credits alone aren't worth a daily email; mentioned when something else already is.
  if (f.unmatched && out.length) out.push(`${f.unmatched} payment(s) received in the bank aren’t matched to a bill yet.`);
  return [...out, ...conn];
}

/** Sidebar badges and the bell's alert list, from live data. Backup alerts go to those who manage backups. */
export async function badgesAndAlerts(tenantId: string, branchId: string, perms: readonly string[] = []) {
  const today = dateOnly(todayISO());
  const [meds, sellable, exp30, waFailed, recalls, conflicts, due, newOrders, cheques, wa] = await Promise.all([
    db.medicine.findMany({ where: { tenantId, active: true, reorderLevel: { gt: 0 } }, select: { id: true, name: true, reorderLevel: true } }),
    sellableByMedicine(tenantId, branchId),
    db.batch.count({ where: { tenantId, branchId, qtyAvailable: { gt: 0 }, status: "ok", expiryDate: { gt: today, lte: dateOnly(addDays(todayISO(), 30)) } } }),
    // Failures the worker won't fix by itself: permanent ones and retries that ran out, from the past week.
    db.waMessage.count({ where: { tenantId, status: "failed", updatedAt: { gte: new Date(Date.now() - 7 * 86400_000) }, NOT: [{ errorKind: "retry", attempts: { lt: 3 } }, { errorKind: "auth" }] } }),
    db.recall.count({ where: { tenantId, status: { not: "resolved" } } }),
    db.offlineOp.count({ where: { tenantId, status: "conflict" } }),
    db.supplierBill.findMany({ where: { tenantId, dueDate: { lte: dateOnly(addDays(todayISO(), 3)) } } }),
    db.deliveryOrder.count({ where: { tenantId, branchId, status: "new" } }),
    db.cheque.count({ where: { tenantId, status: { in: ["pending", "deposited"] }, chequeDate: { lte: dateOnly(addDays(todayISO(), 3)) } } }),
    db.integration.findUnique({ where: { tenantId_kind: { tenantId, kind: "whatsapp" } }, select: { connectedAt: true, config: true } }),
  ]);
  const waOff = !!wa?.connectedAt && !!(wa.config as { disconnected?: unknown }).disconnected;
  const low = meds.filter((m) => (sellable.get(m.id) ?? 0) < m.reorderLevel);
  const dueOpen = due.filter((b) => b.paidPaise < b.amountPaise);
  const badges: Partial<Record<ScreenId, [number, "amber" | "red"]>> = {
    inv: [low.length, "amber"], exp: [exp30, "red"], wa: [waFailed + (waOff ? 1 : 0), "red"], recall: [recalls, "amber"], sync: [conflicts, "red"], ord: [newOrders, "amber"], chq: [cheques, "amber"],
  };
  const alerts: string[] = [];
  if (newOrders) alerts.push(`${newOrders} new order${newOrders > 1 ? "s" : ""} to confirm`);
  if (waOff) alerts.push("WhatsApp disconnected: Meta rejected the access token. Reconnect under WhatsApp");
  if (low.length) alerts.push(low.length === 1 ? `${low[0].name} low stock` : `${low.length} medicines low on stock`);
  if (exp30) alerts.push(`${exp30} batch${exp30 > 1 ? "es" : ""} expire in 30 days`);
  if (dueOpen.length) alerts.push(`${dueOpen.length} supplier payment${dueOpen.length > 1 ? "s" : ""} due in 3 days`);
  if (cheques) alerts.push(`${cheques} cheque${cheques > 1 ? "s" : ""} to deposit or clear`);
  if (recalls) alerts.push(`${recalls} open recall${recalls > 1 ? "s" : ""}`);
  if (waFailed) alerts.push(`${waFailed} WhatsApp message${waFailed > 1 ? "s" : ""} failed and won’t be retried`);
  if (perms.includes("integrations")) {
    const backup = await backupHealth(tenantId);
    if (backup.length) { badges.bak = [backup.length, "red"]; alerts.unshift(...backup); }
  }
  return { badges, alerts };
}
