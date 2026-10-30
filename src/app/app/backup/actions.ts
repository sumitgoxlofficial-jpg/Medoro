"use server";
import { revalidatePath } from "next/cache";
import { run } from "@/server/action";
import { writeAudit } from "@/server/audit";
import { db } from "@/server/db";
import { authorize } from "@/server/context";
import { applyRestore, backupNow, discardRestore, prepareRestore, saveBackupSettings, testRestore } from "@/domain/system/backup";
import { importBackup, reenterKit } from "@/domain/system/recovery";
import { driveDisconnect, listDriveBackups, tenantDrive } from "@/domain/system/gdrive";
import type { FileStore } from "@/server/storage";

const fresh = <T,>(r: T) => { revalidatePath("/app", "layout"); return r; };
export async function backupNowAction() { return fresh(await run(async (c) => backupNow(c))); }
export async function restoreAction(id: string) { return fresh(await run(async (c) => testRestore(c, id))); }
export async function settingsAction(schedule: string, retention: number, files: FileStore) { return fresh(await run((c) => saveBackupSettings(c, { schedule, retention, files }), "Settings saved.")); }
export async function disconnectAction() {
  return fresh(await run(async (c) => {
    authorize(c, "integrations");
    const revoked = await driveDisconnect(c.tenantId);
    await writeAudit(db, { tenantId: c.tenantId, userId: c.userId, userName: c.userName, action: "Google Drive disconnected", entity: "integration", detail: revoked ? "Token revoked at Google" : "Token deleted here; Google couldn't be reached to revoke it" });
    return revoked ? "Drive disconnected and access revoked." : "Drive disconnected here. Google couldn’t be reached to revoke access: remove Medoro under myaccount.google.com → Security → Third-party access.";
  }));
}
export async function prepareRestoreAction(id: string) { return fresh(await run((c) => prepareRestore(c, id))); }
export async function discardRestoreAction(runId: string) { return fresh(await run((c) => discardRestore(c, runId), "Test copy deleted. Live data unchanged.")); }
/** On success every session of this pharmacy has ended, including this one; the browser goes to sign-in. */
export async function applyRestoreAction(runId: string, code: string) { return run((c) => applyRestore(c, runId, code)); }
export async function driveBackupsAction() {
  return run(async (c) => {
    authorize(c, "users");
    const known = new Set((await db.backupManifest.findMany({ where: { tenantId: c.tenantId, driveFileId: { not: null } }, select: { driveFileId: true } })).map((m) => m.driveFileId));
    return (await listDriveBackups(tenantDrive(c.tenantId), c.tenantId)).map((f) => ({ ...f, known: known.has(f.id) }));
  });
}
export async function restoreFromDriveAction(fileId: string, kit: string) { return fresh(await run((c) => importBackup(c, { driveFileId: fileId }, kit))); }
export async function reenterKitAction(kit: string) { return fresh(await run((c) => reenterKit(c, kit), "Recovery kit accepted. Backups work again.")); }
