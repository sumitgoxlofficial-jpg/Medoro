import { redirect } from "next/navigation";
import { requireCtx, can } from "@/server/context";
import { db } from "@/server/db";
import { backupSettings } from "@/domain/system/backup";
import { driveAppConfigured } from "@/domain/system/gdrive";
import { big } from "@/lib/money";
import { PageHead } from "@/components/page-head";
import { t } from "@/lib/i18n";
import { BackupView } from "./view";

export const metadata = { title: "Backup & restore" };

export default async function Page({ searchParams }: { searchParams: Promise<{ drive?: string }> }) {
  const ctx = await requireCtx();
  if (!can(ctx, "integrations")) redirect("/app");
  const [hist, drive, key, settings] = await Promise.all([
    db.backupManifest.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { startedAt: "desc" }, take: 30 }),
    db.integration.findUnique({ where: { tenantId_kind: { tenantId: ctx.tenantId, kind: "gdrive" } } }),
    db.integration.findUnique({ where: { tenantId_kind: { tenantId: ctx.tenantId, kind: "backup_key" } } }),
    backupSettings(ctx.tenantId),
  ]);
  return (
    <>
      <PageHead title={t(ctx.lang).bak} sub="Encrypted backups on your server and your Google Drive" />
      <BackupView
        history={hist.map((h) => ({ id: h.id, at: h.startedAt.toISOString(), kind: h.kind, size: big(h.sizeBytes), sha: h.sha256, status: h.status, error: h.error, drive: !!h.driveFileId, local: !!h.localPath }))}
        drive={drive?.connectedAt ? { account: (drive.config as { account?: string }).account ?? "", since: drive.connectedAt.toISOString() } : null}
        driveApp={driveAppConfigured()} fingerprint={(key?.config as { fingerprint?: string } | null)?.fingerprint ?? null} keyDate={key?.connectedAt?.toISOString() ?? null}
        settings={settings} flash={(await searchParams).drive ?? null}
      />
    </>
  );
}
