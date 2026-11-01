import { redirect } from "next/navigation";
import { after } from "next/server";
import { maybeBackup } from "@/domain/system/backup";
import { requireCtx } from "@/server/context";
import { db } from "@/server/db";
import { Shell } from "@/components/shell/shell";
import { badgesAndAlerts } from "@/domain/reports/alerts";
import { aiStatus } from "@/domain/ai/settings";
import { activeGrantEnd } from "@/domain/identity/support";
import { accessFor } from "@/domain/system/access";
import { subscriptionBanner } from "@/domain/system/subscription";
import { remoteRequests, supportInbox } from "@/domain/system/licence";
import { effectivePerms } from "@/domain/identity/permissions";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  const [user, tenant, live] = await Promise.all([
    db.user.findUnique({ where: { id: ctx.userId }, include: { role: true } }),
    db.tenant.findUnique({ where: { id: ctx.tenantId } }),
    db.session.count({ where: { user: { tenantId: ctx.tenantId }, revokedAt: null, lastSeenAt: { gt: new Date(Date.now() - 5 * 60_000) } } }),
  ]);
  if (!user || !tenant) redirect("/signin");
  // Backups every few hours (if chosen) run after the page is sent, while the pharmacy is using Medoro.
  if (!ctx.readOnly) after(() => maybeBackup(ctx.tenantId).catch(() => {}));
  const { badges, alerts } = await badgesAndAlerts(ctx.tenantId, ctx.branchId, ctx.perms);
  const supportEnd = await activeGrantEnd(ctx.tenantId);
  const ai = await aiStatus(ctx);
  const hm = (d: Date) => d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
  if (supportEnd && !ctx.readOnly && ctx.perms.includes("users")) alerts.unshift(`Medoro support has read-only access until ${hm(supportEnd)}. End it under Privacy & data.`);
  const owner = !ctx.readOnly && ctx.perms.includes("users");
  const [access, support, asks] = await Promise.all([accessFor(ctx.tenantId), supportInbox(ctx.tenantId), owner ? remoteRequests(ctx.tenantId) : []]);
  if (support.unread) badges.help = [support.unread, "amber"];
  if (asks.length) { badges.privacy = [asks.length, "amber"]; alerts.unshift("Medoro support asked for access to your data. Approve or decline under Privacy & data."); }
  const banner = subscriptionBanner(access);
  const move = (tenant.settings as { driveMove?: { state: string; movedAt?: string } }).driveMove;
  if (move) alerts.unshift(move.state === "moved"
    ? `Your pharmacy’s data now lives in your Google Drive (moved ${new Date(move.movedAt!).toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "Asia/Kolkata" })}). Medoro’s copy is read-only: bill on Billing (device).`
    : "Your data is moving to Google Drive. Medoro’s copy is read-only until the move finishes or is cancelled.");
  const del = (tenant.settings as { deletion?: { scheduledFor?: string } }).deletion?.scheduledFor;
  const deletionOn = del ? new Date(del).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : null;
  const strict = ((tenant.settings as { privacy?: { strict?: boolean } }).privacy?.strict ?? true) !== false;
  const deployment = { cloud: "Your cloud", onprem: "On-premises", lan: "Shop LAN", hosted: "Hosted PostgreSQL", single: "Single device" }[((tenant.settings as { deployment?: string }).deployment ?? "lan") as "lan"] ?? "Self-hosted";
  return (
    <Shell
      tenantName={ctx.tenantName} branchCount={ctx.branches.length} userName={ctx.userName} userEmail={ctx.userEmail}
      role={ctx.role} realRole={ctx.realRole} canViewAs={effectivePerms(user.role.permissions, user.permGrants, user.permRevokes).includes("users")} perms={ctx.perms}
      branchId={ctx.branchId} branchName={ctx.branchName} branches={ctx.branches} lang={ctx.lang} mfa={user.mfaEnabled}
      deployment={deployment} strict={strict} liveDevices={live} badges={badges} alerts={alerts} ai={{ enabled: ai.enabled, globalOff: ai.globalOff, mode: ai.mode, canManage: ai.canManage }} supportUntil={ctx.readOnly && supportEnd ? hm(supportEnd) : null}
      subscription={banner ? { ...banner, renew: ctx.perms.includes("users") } : null}
      deletionOn={deletionOn}
    >
      {children}
    </Shell>
  );
}
