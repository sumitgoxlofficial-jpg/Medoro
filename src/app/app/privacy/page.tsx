import { redirect } from "next/navigation";
import { requireCtx, can } from "@/server/context";
import { db } from "@/server/db";
import { getGrievance, getPrivacy } from "@/domain/system/privacy";
import { STRICT_RULES } from "@/domain/system/strict";
import { RETENTION_RULES, retentionPreview } from "@/domain/system/retention";
import { PageHead } from "@/components/page-head";
import { t } from "@/lib/i18n";
import { PrivacyView } from "./view";
import { SupportCard } from "./support-card";
import { GrievanceCard, RetentionCard } from "./privacy-cards";
import { supportStatus } from "@/domain/identity/support";

export const metadata = { title: "Privacy & data" };

export default async function Page() {
  const ctx = await requireCtx();
  if (!can(ctx, "users")) redirect("/app");
  const [p, customers, integrations, grants, grievance, tenant, retention] = await Promise.all([
    getPrivacy(ctx.tenantId), db.customer.findMany({ where: { tenantId: ctx.tenantId, erasedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.integration.findMany({ where: { tenantId: ctx.tenantId }, select: { kind: true, connectedAt: true } }),
    supportStatus(ctx), getGrievance(ctx.tenantId), db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { phone: true } }), retentionPreview(ctx.tenantId),
  ]);
  const on = (k: string) => integrations.some((i) => i.kind === k && i.connectedAt);
  return (
    <>
      <PageHead title={t(ctx.lang).privacy} sub="Data ownership, external services, export and deletion" />
      <div className="flex flex-col gap-4">
        <PrivacyView p={p} customers={customers} wa={on("whatsapp")} drive={on("gdrive")} licence={!!process.env.LICENSE_SERVER_URL}
          strictRules={[...STRICT_RULES]} telemetryUrl={!!process.env.TELEMETRY_URL} crashUrl={!!process.env.CRASH_REPORT_URL} />
        <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] max-w-[1200px] items-start">
          <RetentionCard rules={RETENTION_RULES} initial={retention.counts} years={retention.years} cutoff={retention.customerCutoff} canRun={!ctx.readOnly} />
          <GrievanceCard initial={grievance} pharmacyPhone={tenant.phone} />
        </div>
        <SupportCard grants={grants} />
      </div>
    </>
  );
}
