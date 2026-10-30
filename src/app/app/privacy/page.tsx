import { redirect } from "next/navigation";
import { requireCtx, can } from "@/server/context";
import { db } from "@/server/db";
import { getPrivacy } from "@/domain/system/privacy";
import { PageHead } from "@/components/page-head";
import { t } from "@/lib/i18n";
import { PrivacyView } from "./view";
import { SupportCard } from "./support-card";
import { supportStatus } from "@/domain/identity/support";
import { aiStatus } from "@/domain/ai/settings";

export const metadata = { title: "Privacy & data" };

export default async function Page() {
  const ctx = await requireCtx();
  if (!can(ctx, "users")) redirect("/app");
  const [p, customers, integrations, grants] = await Promise.all([
    getPrivacy(ctx.tenantId), db.customer.findMany({ where: { tenantId: ctx.tenantId, erasedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.integration.findMany({ where: { tenantId: ctx.tenantId }, select: { kind: true, connectedAt: true } }),
    supportStatus(ctx),
  ]);
  const ai = await aiStatus(ctx);
  const remoteHost = (() => { try { return process.env.REMOTE_AI_URL ? new URL(process.env.REMOTE_AI_URL).host : null; } catch { return null; } })();
  const on = (k: string) => integrations.some((i) => i.kind === k && i.connectedAt);
  return (
    <>
      <PageHead title={t(ctx.lang).privacy} sub="Data ownership, external services, export and deletion" />
      <div className="flex flex-col gap-4">
        <PrivacyView p={p} customers={customers} wa={on("whatsapp")} drive={on("gdrive")} licence={!!process.env.LICENSE_SERVER_URL} ai={{ enabled: ai.enabled, globalOff: ai.globalOff, remoteNames: ai.remoteNames, mode: ai.mode, note: ai.note ?? null, remoteHost }} />
        <SupportCard grants={grants} />
      </div>
    </>
  );
}
