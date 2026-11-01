"use server";
import { UserError } from "@/server/action";
import { restoreStep } from "./setup-step";
import { dropSetupDrive, setupDrive } from "@/server/setup-drive";
import { driveDownload, listDriveBackups, tokenDrive } from "@/domain/system/gdrive";
import { freshRestore, previewFreshRestore } from "@/domain/system/recovery";

/** The Google account connected in the setup popup, if any. */
export async function setupDriveStatus() {
  return restoreStep(async () => (await setupDrive())?.account ?? null);
}

export async function setupDriveForget() {
  return restoreStep(async () => { await dropSetupDrive(); return null; });
}

async function heldDrive() {
  const d = await setupDrive();
  if (!d) throw new UserError("Connect Google Drive first.");
  return d;
}

export async function setupDriveBackups() {
  return restoreStep(async () => listDriveBackups(tokenDrive((await heldDrive()).refreshToken)));
}

export async function setupPreviewFromDrive(fileId: string, kit: string) {
  return restoreStep(async () => previewFreshRestore(await driveDownload(tokenDrive((await heldDrive()).refreshToken), fileId), kit));
}

/** Restores the Drive backup and keeps the Drive connection for the restored pharmacy. */
export async function setupRestoreFromDrive(fileId: string, kit: string, code: string) {
  return restoreStep(async () => {
    const d = await heldDrive();
    const r = await freshRestore(await driveDownload(tokenDrive(d.refreshToken), fileId), kit, code, d, fileId);
    await dropSetupDrive();
    return r;
  });
}
