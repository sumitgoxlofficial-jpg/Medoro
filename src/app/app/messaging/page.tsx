import { redirect } from "next/navigation";
import { requireCtx, can } from "@/server/context";
import { crmSettings, listCampaigns, optInCount, optOuts, paymentDues, refillReminders, smsStatus } from "@/domain/comms/crm";
import { waStatus } from "@/domain/comms/whatsapp";
import { loyaltySettings } from "@/domain/sales/loyalty";
import { PageHead } from "@/components/page-head";
import { t } from "@/lib/i18n";
import { CrmView } from "./view";

export const metadata = { title: "Customer messaging" };

export default async function Page() {
  const ctx = await requireCtx();
  if (!can(ctx, "integrations")) redirect("/app");
  const [s, reminders, campaigns, outs, counts, wa, dues, sms, loyalty] = await Promise.all([
    crmSettings(ctx.tenantId), refillReminders(ctx), listCampaigns(ctx), optOuts(ctx), optInCount(ctx), waStatus(ctx.tenantId), paymentDues(ctx), smsStatus(ctx.tenantId), loyaltySettings(ctx.tenantId),
  ]);
  const connected = wa.connected && !wa.cfg.disconnected;
  return (
    <>
      <PageHead title={t(ctx.lang).crm} sub="Opt-in reminders, store updates, loyalty points and opt-outs" />
      <CrmView s={s} reminders={reminders} campaigns={campaigns} outs={outs} counts={counts} dues={dues} sms={sms} loyalty={loyalty}
        templates={wa.connected ? [...new Set(wa.cfg.templates.filter((x) => x.status === "approved").map((x) => x.name))] : []} connected={connected} />
    </>
  );
}
