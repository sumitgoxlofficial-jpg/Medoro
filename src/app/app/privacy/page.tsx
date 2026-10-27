import { redirect } from "next/navigation";
import { requireCtx, can } from "@/server/context";
import { db } from "@/server/db";
import { getPrivacy } from "@/domain/system/privacy";
import { PageHead } from "@/components/page-head";
import { t } from "@/lib/i18n";
import { PrivacyView } from "./view";

export const metadata = { title: "Privacy & data" };

export default async function Page() {
  const ctx = await requireCtx();
  if (!can(ctx, "users")) redirect("/app");
  const [p, customers, integrations] = await Promise.all([
    getPrivacy(ctx.tenantId), db.customer.findMany({ where: { tenantId: ctx.tenantId, erasedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.integration.findMany({ where: { tenantId: ctx.tenantId }, select: { kind: true, connectedAt: true } }),
  ]);
  const on = (k: string) => integrations.some((i) => i.kind === k && i.connectedAt);
  return (
    <>
      <PageHead title={t(ctx.lang).privacy} sub="Data ownership, external services, export and deletion" />
      <PrivacyView p={p} customers={customers} wa={on("whatsapp")} drive={on("gdrive")} licence={!!process.env.LICENSE_SERVER_URL} />
    </>
  );
}
