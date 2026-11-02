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
import { driveRequired } from "@/domain/system/drive-state";
import { driveNeedsReconnect } from "@/domain/system/gdrive";
import { UNDO_DAYS } from "@/domain/system/drive-move";
import { localeOf, tFor } from "@/lib/tr";

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
  // Alerts built here are put in the chosen language now; the ones from badgesAndAlerts are translated by the shell.
  const t = tFor(ctx.lang), loc = localeOf(ctx.lang);
  const hm = (d: Date) => d.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
  if (supportEnd && !ctx.readOnly && ctx.perms.includes("users")) alerts.unshift(t("Medoro support has read-only access until {time}. End it under Privacy & data.", { time: hm(supportEnd) }));
  const owner = !ctx.readOnly && ctx.perms.includes("users");
  const [access, support, asks] = await Promise.all([accessFor(ctx.tenantId), supportInbox(ctx.tenantId), owner ? remoteRequests(ctx.tenantId) : []]);
  if (support.unread) badges.help = [support.unread, "amber"];
  if (asks.length) { badges.privacy = [asks.length, "amber"]; alerts.unshift(t("Medoro support asked for access to your data. Approve or decline under Privacy & data.")); }
  const banner = subscriptionBanner(access);
  const move = (tenant.settings as { driveMove?: { state: string; movedAt?: string } }).driveMove;
  if (!move && (tenant.settings as { driveOnly?: boolean }).driveOnly) alerts.unshift(t("Your pharmacy’s data lives in your Google Drive. Bill, buy and manage stock on Billing (device)."));
  const dm = (ms: number) => new Date(ms).toLocaleDateString(loc, { day: "numeric", month: "short", timeZone: "Asia/Kolkata" });
  if (move) alerts.unshift(move.state !== "moving"
    ? move.state === "moved" && driveRequired()
      ? t("Your pharmacy’s data now lives in your Google Drive (moved {moved}). Medoro’s copy is read-only and is deleted on {gone}: bill on Billing (device).", { moved: dm(Date.parse(move.movedAt!)), gone: dm(Date.parse(move.movedAt!) + UNDO_DAYS * 86400_000) })
      : t("Your pharmacy’s data now lives in your Google Drive (moved {moved}). Medoro’s copy is read-only: bill on Billing (device).", { moved: dm(Date.parse(move.movedAt!)) })
    : t("Your data is moving to Google Drive. Medoro’s copy is read-only until the move finishes or is cancelled."));
  if (ctx.mustMove) alerts.unshift(owner
    ? t("Medoro now keeps every pharmacy’s data in its own Google Drive. Move yours on Billing (device): until then Medoro’s copy is read-only.")
    : t("Medoro now keeps every pharmacy’s data in its own Google Drive. Until the owner moves it on Billing (device), Medoro’s copy is read-only."));
  if (owner && ctx.moved && (await driveNeedsReconnect(ctx.tenantId))) alerts.unshift(t("Medoro’s files are visible in your Google Drive. Reconnect Google Drive once on Backup & restore to hide them, like WhatsApp backups."));
  const del = (tenant.settings as { deletion?: { scheduledFor?: string } }).deletion?.scheduledFor;
  const deletionOn = del ? new Date(del).toLocaleDateString(loc, { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" }) : null;
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
      driveNav={!!ctx.moved && ctx.perms.includes("sale") && !ctx.readOnly}
    >
      {children}
    </Shell>
  );
}
