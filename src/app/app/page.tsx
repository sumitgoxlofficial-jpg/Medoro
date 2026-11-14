import { redirect } from "next/navigation";
import { db } from "@/server/db";
import { can, requireCtx } from "@/server/context";
import { dashboard, type Range } from "@/domain/reports/dashboard";
import { dashboardFor } from "@/domain/reports/dashboard-access";
import { t as dictFor } from "@/lib/i18n";
import { dateOnly, todayISO, weekdayLong } from "@/lib/dates";
import { tFor } from "@/lib/tr";
import { PageHead } from "@/components/page-head";
import { waStatus } from "@/domain/comms/whatsapp";
import { driveAppConfigured, driveState } from "@/domain/system/gdrive";
import { Dashboard, DashActions } from "./dashboard";
import { DueCheques } from "./cheques/due-widget";

export const metadata = { title: "Dashboard" };

const driveOnlyOrPurged = async (tenantId: string) => {
  const s = ((await db.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } }))?.settings ?? {}) as { driveOnly?: boolean; driveMove?: { state?: string } };
  return s.driveOnly === true || s.driveMove?.state === "purged";
};

export default async function Page({ searchParams }: { searchParams: Promise<{ range?: string }> }) {
  const ctx = await requireCtx();
  if (can(ctx, "delivery") && !can(ctx, "sale") && !can(ctx, "reports")) redirect("/app/deliveries");
  // Records live on the counters (Drive mode): Medoro's dashboard would be empty, so open the counter.
  if (ctx.moved && can(ctx, "sale") && (await driveOnlyOrPurged(ctx.tenantId))) redirect("/app/device-pos?tab=dash");
  // Still on Medoro's copy where Drive is required: the owner moves it from the counter.
  if (ctx.mustMove && can(ctx, "sale")) redirect("/app/device-pos");
  const { range: r } = await searchParams;
  const range: Range = r === "7d" || r === "30d" ? r : "today";
  const data = dashboardFor(await dashboard(ctx.tenantId, ctx.branchId, range, ctx.branches.map((b) => b.id)), ctx.perms);
  const d = dictFor(ctx.lang), t = tFor(ctx.lang);
  const day = ctx.lang === "hi" ? dateOnly(todayISO()).toLocaleDateString("hi-IN", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : weekdayLong();
  const wa = can(ctx, "integrations") ? await waStatus(ctx.tenantId) : null;
  // One-tap Google Drive backup, like WhatsApp: shown to whoever can connect it until it is connected.
  const drive = can(ctx, "integrations") && !ctx.readOnly && driveAppConfigured() ? await driveState(ctx.tenantId) : null;
  return (
    <>
      <PageHead title={d.dash} sub={`${day} · ${ctx.branchName}`} right={<DashActions range={range} data={data} branch={ctx.branchName} canExport={can(ctx, "reports") && !ctx.readOnly} />} />
      {wa?.connected && wa.cfg.disconnected ? (
        <div role="alert" className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-[#E5B4AE] bg-bad-bg px-4 py-3 text-[13.5px] text-bad">
          <strong className="font-semibold">{t("WhatsApp is disconnected.")}</strong> {t(wa.cfg.via === "phone" ? "The linked phone was signed out ({reason}). Invoices and reminders are paused." : "Meta rejected the access token ({reason}). Invoices and reminders are paused.", { reason: wa.cfg.disconnected.reason })}
          <a href="/app/whatsapp" className="ml-auto font-semibold underline">{wa.cfg.via === "phone" ? t("Link again") : t("Reconnect")}</a>
        </div>
      ) : null}
      {drive && drive.status !== "connected" ? (
        <div className="mb-3 flex flex-wrap items-center gap-3 rounded-xl border border-teal-line bg-white px-4 py-3 text-[13.5px]">
          <div className="flex flex-col gap-0.5 min-w-[220px] flex-1">
            <strong className="font-semibold">{drive.status === "lost" ? t("Google Drive backup stopped") : t("Back up to your Google Drive")}</strong>
            <span className="text-muted">{drive.status === "lost" ? t("Reconnect so your daily backups keep going to your Drive.") : t("One tap. Medoro then saves an encrypted backup of your pharmacy to your own Google Drive every day.")}</span>
          </div>
          <a href="/api/integrations/google/start" className="bg-teal text-white rounded-lg px-3.5 py-2 font-semibold no-underline hover:bg-teal-hover hover:text-white">{drive.status === "lost" ? t("Reconnect Google Drive") : t("Connect Google Drive")}</a>
        </div>
      ) : null}
      <Dashboard data={data} dict={d} perms={ctx.perms} userName={ctx.userName} branch={ctx.branchName} />
      <DueCheques ctx={ctx} />
    </>
  );
}
