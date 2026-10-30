import "server-only";
import { db } from "@/server/db";
import { addDays, dateOnly, todayISO } from "@/lib/dates";
import { sellableByMedicine } from "@/domain/inventory/queries";
import type { ScreenId } from "@/lib/nav";

/** Sidebar badges and the bell's alert list, from live data. */
export async function badgesAndAlerts(tenantId: string, branchId: string) {
  const today = dateOnly(todayISO());
  const [meds, sellable, exp30, waFailed, recalls, conflicts, due, wa] = await Promise.all([
    db.medicine.findMany({ where: { tenantId, active: true, reorderLevel: { gt: 0 } }, select: { id: true, name: true, reorderLevel: true } }),
    sellableByMedicine(tenantId, branchId),
    db.batch.count({ where: { tenantId, branchId, qtyAvailable: { gt: 0 }, status: "ok", expiryDate: { gt: today, lte: dateOnly(addDays(todayISO(), 30)) } } }),
    // Failures the worker won't fix by itself: permanent ones and retries that ran out, from the past week.
    db.waMessage.count({ where: { tenantId, status: "failed", updatedAt: { gte: new Date(Date.now() - 7 * 86400_000) }, NOT: [{ errorKind: "retry", attempts: { lt: 3 } }, { errorKind: "auth" }] } }),
    db.recall.count({ where: { tenantId, status: { not: "resolved" } } }),
    db.offlineOp.count({ where: { tenantId, status: "conflict" } }),
    db.supplierBill.findMany({ where: { tenantId, dueDate: { lte: dateOnly(addDays(todayISO(), 3)) } } }),
    db.integration.findUnique({ where: { tenantId_kind: { tenantId, kind: "whatsapp" } }, select: { connectedAt: true, config: true } }),
  ]);
  const waOff = !!wa?.connectedAt && !!(wa.config as { disconnected?: unknown }).disconnected;
  const low = meds.filter((m) => (sellable.get(m.id) ?? 0) < m.reorderLevel);
  const dueOpen = due.filter((b) => b.paidPaise < b.amountPaise);
  const badges: Partial<Record<ScreenId, [number, "amber" | "red"]>> = {
    inv: [low.length, "amber"], exp: [exp30, "red"], wa: [waFailed + (waOff ? 1 : 0), "red"], recall: [recalls, "amber"], sync: [conflicts, "red"],
  };
  const alerts: string[] = [];
  if (waOff) alerts.push("WhatsApp disconnected: Meta rejected the access token. Reconnect under WhatsApp");
  if (low.length) alerts.push(low.length === 1 ? `${low[0].name} low stock` : `${low.length} medicines low on stock`);
  if (exp30) alerts.push(`${exp30} batch${exp30 > 1 ? "es" : ""} expire in 30 days`);
  if (dueOpen.length) alerts.push(`${dueOpen.length} supplier payment${dueOpen.length > 1 ? "s" : ""} due in 3 days`);
  if (recalls) alerts.push(`${recalls} open recall${recalls > 1 ? "s" : ""}`);
  if (waFailed) alerts.push(`${waFailed} WhatsApp message${waFailed > 1 ? "s" : ""} failed and won’t be retried`);
  return { badges, alerts };
}
