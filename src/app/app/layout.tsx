import { redirect } from "next/navigation";
import { requireCtx } from "@/server/context";
import { db } from "@/server/db";
import { Shell } from "@/components/shell/shell";
import { badgesAndAlerts } from "@/domain/reports/alerts";
import { aiMode } from "@/domain/ai/service";
import { activeGrantEnd } from "@/domain/identity/support";

export const dynamic = "force-dynamic";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireCtx();
  const [user, tenant, live] = await Promise.all([
    db.user.findUnique({ where: { id: ctx.userId }, include: { role: true } }),
    db.tenant.findUnique({ where: { id: ctx.tenantId } }),
    db.session.count({ where: { user: { tenantId: ctx.tenantId }, revokedAt: null, lastSeenAt: { gt: new Date(Date.now() - 5 * 60_000) } } }),
  ]);
  if (!user || !tenant) redirect("/signin");
  const { badges, alerts } = await badgesAndAlerts(ctx.tenantId, ctx.branchId);
  const supportEnd = await activeGrantEnd(ctx.tenantId);
  const hm = (d: Date) => d.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata" });
  if (supportEnd && !ctx.readOnly && ctx.perms.includes("users")) alerts.unshift(`Medoro support has read-only access until ${hm(supportEnd)}. End it under Privacy & data.`);
  const strict = ((tenant.settings as { privacy?: { strict?: boolean } }).privacy?.strict ?? true) !== false;
  const deployment = { cloud: "Your cloud", onprem: "On-premises", lan: "Shop LAN", hosted: "Hosted PostgreSQL", single: "Single device" }[((tenant.settings as { deployment?: string }).deployment ?? "lan") as "lan"] ?? "Self-hosted";
  return (
    <Shell
      tenantName={ctx.tenantName} branchCount={ctx.branches.length} userName={ctx.userName} userEmail={ctx.userEmail}
      role={ctx.role} realRole={ctx.realRole} canViewAs={user.role.permissions.includes("users")} perms={ctx.perms}
      branchId={ctx.branchId} branchName={ctx.branchName} branches={ctx.branches} lang={ctx.lang} mfa={user.mfaEnabled}
      deployment={deployment} strict={strict} liveDevices={live} badges={badges} alerts={alerts} aiMode={aiMode()} supportUntil={ctx.readOnly && supportEnd ? hm(supportEnd) : null}
    >
      {children}
    </Shell>
  );
}
