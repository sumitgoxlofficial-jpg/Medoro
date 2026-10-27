"use server";
import { revalidatePath } from "next/cache";
import { run } from "@/server/action";
import { writeAudit } from "@/server/audit";
import { db } from "@/server/db";
import { authorize } from "@/server/context";
import { applyRestore, backupNow, discardRestore, prepareRestore, saveBackupSettings, testRestore } from "@/domain/system/backup";
import { driveDisconnect } from "@/domain/system/gdrive";

const fresh = <T,>(r: T) => { revalidatePath("/app", "layout"); return r; };
export async function backupNowAction() { return fresh(await run(async (c) => backupNow(c))); }
export async function restoreAction(id: string) { return fresh(await run(async (c) => testRestore(c, id))); }
export async function settingsAction(schedule: string, retention: number) { return fresh(await run((c) => saveBackupSettings(c, { schedule, retention }), "Schedule saved.")); }
export async function disconnectAction() {
  return fresh(await run(async (c) => { authorize(c, "integrations"); await driveDisconnect(c.tenantId); await writeAudit(db, { tenantId: c.tenantId, userId: c.userId, userName: c.userName, action: "Google Drive disconnected", entity: "integration", detail: "Token revoked" }); }, "Drive disconnected and access revoked."));
}
export async function prepareRestoreAction(id: string) { return fresh(await run((c) => prepareRestore(c, id))); }
export async function discardRestoreAction(runId: string) { return fresh(await run((c) => discardRestore(c, runId), "Test copy deleted. Live data unchanged.")); }
/** On success every session of this pharmacy has ended, including this one; the browser goes to sign-in. */
export async function applyRestoreAction(runId: string, code: string) { return run((c) => applyRestore(c, runId, code)); }
