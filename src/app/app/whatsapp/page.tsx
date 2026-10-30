import { redirect } from "next/navigation";
import { requireCtx, can } from "@/server/context";
import { embeddedSignupConfig, invoiceTemplateState, messageLog, waSettings, waStatus } from "@/domain/comms/whatsapp";
import { PageHead } from "@/components/page-head";
import { t } from "@/lib/i18n";
import { WhatsAppView } from "./view";

export const metadata = { title: "WhatsApp" };

export default async function Page() {
  const ctx = await requireCtx();
  if (!can(ctx, "integrations")) redirect("/app");
  const [st, log, settings, tpl] = await Promise.all([waStatus(ctx.tenantId), messageLog(ctx), waSettings(ctx.tenantId), invoiceTemplateState(ctx.tenantId)]);
  const base = process.env.APP_URL ?? "https://your-server";
  return (
    <>
      <PageHead title={t(ctx.lang).wa} sub="Meta WhatsApp Business Cloud API, using your own Meta account" />
      <WhatsAppView st={st} log={log} settings={settings} invoiceTemplate={tpl} signup={embeddedSignupConfig()} webhook={`${base.replace(/\/$/, "")}/api/wa/webhook`} />
    </>
  );
}
