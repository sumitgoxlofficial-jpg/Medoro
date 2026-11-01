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
import { checkIn, remoteRequests } from "@/domain/system/licence";
import { aiStatus } from "@/domain/ai/settings";
import { DELETE_WAIT_DAYS, deletionPlan } from "@/domain/system/deletion";
import { DeleteAccountCard } from "./delete-card";
import { dataInDrive } from "@/domain/system/drive-state";

export const metadata = { title: "Privacy & data" };

export default async function Page() {
  const ctx = await requireCtx();
  if (!can(ctx, "users")) redirect("/app");
  if (!ctx.readOnly) await checkIn(ctx.tenantId, { minAgeMs: 10 * 60_000, timeoutMs: 4000 });
  const [p, customers, integrations, grants, asks, grievance, tenant, retention] = await Promise.all([
    getPrivacy(ctx.tenantId), db.customer.findMany({ where: { tenantId: ctx.tenantId, erasedAt: null }, orderBy: { name: "asc" }, select: { id: true, name: true } }),
    db.integration.findMany({ where: { tenantId: ctx.tenantId }, select: { kind: true, connectedAt: true } }),
    supportStatus(ctx), remoteRequests(ctx.tenantId), getGrievance(ctx.tenantId), db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { phone: true, code: true, settings: true } }), retentionPreview(ctx.tenantId),
  ]);
  const [ai, plan] = await Promise.all([aiStatus(ctx), deletionPlan(ctx.tenantId)]);
  const remoteHost = (() => { try { return process.env.REMOTE_AI_URL ? new URL(process.env.REMOTE_AI_URL).host : null; } catch { return null; } })();
  const on = (k: string) => integrations.some((i) => i.kind === k && i.connectedAt);
  const inDrive = dataInDrive(tenant.settings);
  const move = (tenant.settings as { driveMove?: { state?: string } }).driveMove;
  return (
    <>
      <PageHead title={t(ctx.lang).privacy} sub="Data ownership, external services, export and deletion" />
      <div className="flex flex-col gap-4">
        <div className="bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] p-4 flex flex-col gap-1.5 max-w-[1200px]" data-testid="data-home">
          <div className="font-semibold text-[15px]">Where your pharmacy’s records live</div>
          <div className="text-[13.5px] text-muted">{inDrive
            ? <>On your counters and in your own Google Drive, encrypted with keys only you hold. Medoro keeps your account and device list, not your bills, stock or customers{move?.state === "moved" ? "; its old copy is read-only until you delete it (Drive mode card on the speed-test page)" : ""}. Keep your Drive recovery code safe: Medoro can’t restore your data without it.</>
            : <>In this pharmacy’s database on Medoro’s server, backed up (encrypted) to your Google Drive if connected. You can move everything into your own Google Drive from Billing (device) once Drive mode is on.</>}</div>
        </div>
        <PrivacyView p={p} customers={customers} wa={on("whatsapp")} drive={on("gdrive")} driveRecords={inDrive} licence={!!process.env.LICENSE_SERVER_URL} ai={{ enabled: ai.enabled, globalOff: ai.globalOff, remoteNames: ai.remoteNames, mode: ai.mode, note: ai.note ?? null, remoteHost }}
          strictRules={[...STRICT_RULES]} telemetryUrl={!!process.env.TELEMETRY_URL} crashUrl={!!process.env.CRASH_REPORT_URL} />
        <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] max-w-[1200px] items-start">
          <RetentionCard rules={RETENTION_RULES} initial={retention.counts} years={retention.years} cutoff={retention.customerCutoff} canRun={!ctx.readOnly} />
          <GrievanceCard initial={grievance} pharmacyPhone={tenant.phone} />
        </div>
        <SupportCard grants={grants} requests={asks} />
        <div id="delete-account"><DeleteAccountCard code={tenant.code} plan={plan} isOwner={ctx.realRole === "Owner" && ctx.role === "Owner" && !ctx.readOnly} waitDays={DELETE_WAIT_DAYS} /></div>
      </div>
    </>
  );
}
