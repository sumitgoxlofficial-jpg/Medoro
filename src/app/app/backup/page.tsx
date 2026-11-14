import { CloudUpload } from "lucide-react";
import { redirect } from "next/navigation";
import { requireCtx, can } from "@/server/context";
import { db } from "@/server/db";
import { backupSettings, pendingRestore } from "@/domain/system/backup";
import { keyHealth } from "@/domain/system/recovery";
import { driveAppConfigured, driveNeedsReconnect, driveState, pharmacyFolderName } from "@/domain/system/gdrive";
import { backupHealth } from "@/domain/reports/alerts";
import { big } from "@/lib/money";
import { PageHead } from "@/components/page-head";
import { t } from "@/lib/i18n";
import { tFor } from "@/lib/tr";
import { BackupView } from "./view";

export const metadata = { title: "Backup & restore" };

export default async function Page({ searchParams }: { searchParams: Promise<{ drive?: string }> }) {
  const ctx = await requireCtx();
  if (!can(ctx, "integrations")) redirect("/app");
  const [hist, drive, key, keyState, settings, pending, tenant, problems] = await Promise.all([
    db.backupManifest.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { startedAt: "desc" }, take: 30 }),
    driveState(ctx.tenantId),
    db.integration.findUnique({ where: { tenantId_kind: { tenantId: ctx.tenantId, kind: "backup_key" } } }),
    keyHealth(ctx.tenantId),
    backupSettings(ctx.tenantId),
    can(ctx, "users") ? pendingRestore(ctx) : null,
    db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { code: true, name: true } }),
    backupHealth(ctx.tenantId),
  ]);
  const reconnect = await driveNeedsReconnect(ctx.tenantId);
  return (
    <>
      <PageHead icon={CloudUpload} title={t(ctx.lang).bak} sub="Encrypted backups and files in your own Google Drive, like WhatsApp. Medoro keeps no copy once Drive has it." />
      {ctx.moved ? (
        <div role="status" className="mb-3 rounded-xl border border-line bg-white px-4 py-3 text-[13.5px]" data-testid="drive-backups-note">
          <strong className="font-semibold">{tFor(ctx.lang)("Your pharmacy’s records live in your Google Drive.")}</strong> {tFor(ctx.lang)("Keep Google Drive connected here: the counters save through it.")}
        </div>
      ) : null}
      <BackupView
        history={hist.map((h) => ({ id: h.id, at: h.startedAt.toISOString(), kind: h.kind, size: big(h.sizeBytes), sha: h.sha256, status: h.status, error: h.error, drive: !!h.driveFileId, local: !!h.localPath }))}
        drive={drive} folder={ctx.moved ? (reconnect ? `Medoro/${pharmacyFolderName(tenant)} (visible in your Drive)` : "Hidden app data, not shown in your Drive (like WhatsApp backups)") : `Medoro/${pharmacyFolderName(tenant)}`} reconnect={reconnect && ctx.moved} inDrive={!!ctx.moved}
        driveApp={driveAppConfigured()} fingerprint={(key?.config as { fingerprint?: string } | null)?.fingerprint ?? null} keyDate={key?.connectedAt?.toISOString() ?? null} keyState={keyState}
        settings={settings} flash={(await searchParams).drive ?? null} problems={problems}
        canRestore={can(ctx, "users")} pendingRestore={pending} code={tenant.code} hostCron={!!process.env.VERCEL} mustMove={!!ctx.mustMove && can(ctx, "users")}
      />
    </>
  );
}
