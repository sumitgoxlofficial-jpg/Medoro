import { redirect } from "next/navigation";
import { requireCtx, can } from "@/server/context";
import { messageLog, waSettings, waStatus } from "@/domain/comms/whatsapp";
import { PageHead } from "@/components/page-head";
import { t } from "@/lib/i18n";
import { WhatsAppView } from "./view";

export const metadata = { title: "WhatsApp" };

export default async function Page() {
  const ctx = await requireCtx();
  if (!can(ctx, "integrations")) redirect("/app");
  const [st, log, settings] = await Promise.all([waStatus(ctx.tenantId), messageLog(ctx), waSettings(ctx.tenantId)]);
  const base = process.env.APP_URL ?? "https://your-server";
  return (
    <>
      <PageHead title={t(ctx.lang).wa} sub="Meta WhatsApp Business Cloud API, using your own Meta account" />
      <WhatsAppView st={st} log={log} auto={settings.auto} webhook={`${base.replace(/\/$/, "")}/api/wa/webhook`} />
    </>
  );
}
