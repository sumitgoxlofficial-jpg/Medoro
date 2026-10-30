import "server-only";
import { db } from "@/server/db";
import { addDays, dateOnly, todayISO } from "@/lib/dates";
import { sellableByMedicine } from "@/domain/inventory/queries";
import { driveState } from "@/domain/system/gdrive";
import type { ScreenId } from "@/lib/nav";

const OVERDUE_MS = 26 * 3600_000;

/** Backup problems the owner should act on: a failed or incomplete last backup, none in 26 hours, lost Drive access. */
export async function backupHealth(tenantId: string, now = new Date()) {
  const real = { tenantId, kind: { not: "imported" } };
  const [tenant, lastOk, last, drive] = await Promise.all([
    db.tenant.findUnique({ where: { id: tenantId }, select: { createdAt: true } }),
    db.backupManifest.findFirst({ where: { ...real, status: { in: ["verified", "partial"] } }, orderBy: { startedAt: "desc" } }),
    db.backupManifest.findFirst({ where: { ...real, status: { not: "running" } }, orderBy: { startedAt: "desc" } }),
    driveState(tenantId),
  ]);
  const problems: string[] = [];
  if (last?.status === "failed") problems.push(`Last backup failed: ${last.error ?? "unknown error"}`);
  else if (last?.status === "partial" && last.error) problems.push(`Last backup is incomplete: ${last.error}`);
  const since = lastOk?.startedAt ?? tenant?.createdAt;
  if (since && now.getTime() - since.getTime() > OVERDUE_MS) problems.push(lastOk ? `No successful backup for ${Math.floor((now.getTime() - since.getTime()) / 3600_000)} hours` : "No successful backup yet");
  if (drive.status === "lost") problems.push("Google Drive access was lost. Reconnect it in Backup & restore.");
  return problems;
}

/** Sidebar badges and the bell's alert list, from live data. Backup alerts go to those who manage backups. */
export async function badgesAndAlerts(tenantId: string, branchId: string, perms: readonly string[] = []) {
  const today = dateOnly(todayISO());
  const [meds, sellable, exp30, waFailed, recalls, conflicts, due, newOrders, cheques] = await Promise.all([
    db.medicine.findMany({ where: { tenantId, active: true, reorderLevel: { gt: 0 } }, select: { id: true, name: true, reorderLevel: true } }),
    sellableByMedicine(tenantId, branchId),
    db.batch.count({ where: { tenantId, branchId, qtyAvailable: { gt: 0 }, status: "ok", expiryDate: { gt: today, lte: dateOnly(addDays(todayISO(), 30)) } } }),
    db.waMessage.count({ where: { tenantId, status: "failed", attempts: { lt: 3 } } }),
    db.recall.count({ where: { tenantId, status: { not: "resolved" } } }),
    db.offlineOp.count({ where: { tenantId, status: "conflict" } }),
    db.supplierBill.findMany({ where: { tenantId, dueDate: { lte: dateOnly(addDays(todayISO(), 3)) } } }),
    db.deliveryOrder.count({ where: { tenantId, branchId, status: "new" } }),
    db.cheque.count({ where: { tenantId, status: { in: ["pending", "deposited"] }, chequeDate: { lte: dateOnly(addDays(todayISO(), 3)) } } }),
  ]);
  const low = meds.filter((m) => (sellable.get(m.id) ?? 0) < m.reorderLevel);
  const dueOpen = due.filter((b) => b.paidPaise < b.amountPaise);
  const badges: Partial<Record<ScreenId, [number, "amber" | "red"]>> = {
    inv: [low.length, "amber"], exp: [exp30, "red"], wa: [waFailed, "red"], recall: [recalls, "amber"], sync: [conflicts, "red"], ord: [newOrders, "amber"], chq: [cheques, "amber"],
  };
  const alerts: string[] = [];
  if (newOrders) alerts.push(`${newOrders} new order${newOrders > 1 ? "s" : ""} to confirm`);
  if (low.length) alerts.push(low.length === 1 ? `${low[0].name} low stock` : `${low.length} medicines low on stock`);
  if (exp30) alerts.push(`${exp30} batch${exp30 > 1 ? "es" : ""} expire in 30 days`);
  if (dueOpen.length) alerts.push(`${dueOpen.length} supplier payment${dueOpen.length > 1 ? "s" : ""} due in 3 days`);
  if (cheques) alerts.push(`${cheques} cheque${cheques > 1 ? "s" : ""} to deposit or clear`);
  if (recalls) alerts.push(`${recalls} open recall${recalls > 1 ? "s" : ""}`);
  if (waFailed) alerts.push(`${waFailed} WhatsApp message${waFailed > 1 ? "s" : ""} failed`);
  if (perms.includes("integrations")) {
    const backup = await backupHealth(tenantId);
    if (backup.length) { badges.bak = [backup.length, "red"]; alerts.unshift(...backup); }
  }
  return { badges, alerts };
}
