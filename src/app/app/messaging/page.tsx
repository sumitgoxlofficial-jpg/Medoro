import { redirect } from "next/navigation";
import { requireCtx, can } from "@/server/context";
import { crmSettings, listCampaigns, optInCount, optOuts, refillReminders } from "@/domain/comms/crm";
import { waStatus } from "@/domain/comms/whatsapp";
import { PageHead } from "@/components/page-head";
import { t } from "@/lib/i18n";
import { CrmView } from "./view";

export const metadata = { title: "Customer messaging" };

export default async function Page() {
  const ctx = await requireCtx();
  if (!can(ctx, "integrations")) redirect("/app");
  const [s, reminders, campaigns, outs, counts, wa] = await Promise.all([crmSettings(ctx.tenantId), refillReminders(ctx), listCampaigns(ctx), optOuts(ctx), optInCount(ctx), waStatus(ctx.tenantId)]);
  return (
    <>
      <PageHead title={t(ctx.lang).crm} sub="Opt-in reminders, campaigns and opt-outs" />
      <CrmView s={s} reminders={reminders} campaigns={campaigns} outs={outs} counts={counts} templates={wa.connected ? wa.cfg.templates.filter((x) => x.status === "approved").map((x) => x.name) : []} connected={wa.connected} />
    </>
  );
}
