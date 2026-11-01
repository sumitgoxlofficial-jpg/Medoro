"use server";
import { run, UserError } from "@/server/action";
import { writeAudit } from "@/server/audit";
import { db } from "@/server/db";
import { driveConfigured, deviceDriveToken, deviceDriveAccess, deviceDriveEnabled } from "@/domain/system/gdrive";
import { driveModeOn } from "@/domain/system/drive-mode";
import { deviceSeed, setDriveMode } from "@/domain/system/drive-mode";
import { revalidatePath } from "next/cache";

/** Phase 0 speed test: gives the owner's browser a short-lived Drive pass. Medoro sees no test data. */
export async function speedTestTokenAction() {
  return run(async (c) => {
    if (c.realRole !== "Owner") throw new UserError("Only the pharmacy owner can run the Google Drive test.");
    if (!(await driveConfigured(c.tenantId))) throw new UserError("Connect Google Drive on the Backup page first.");
    const token = await deviceDriveToken(c.tenantId);
    await writeAudit(db, { tenantId: c.tenantId, userId: c.userId, userName: c.userName, action: "DriveDB speed test", entity: "integration", detail: "Short-lived Google Drive access given to this device" });
    return token;
  });
}

/** Drive mode pilot: bill on this device's own database. Owner only. */
export async function setDriveModeAction(on: boolean) {
  const r = await run((c) => setDriveMode(c, on), on ? "Drive mode is on." : "Drive mode is off.");
  revalidatePath("/app", "layout");
  return r;
}

/** This branch's catalogue, stock and customers for a device database. Owner only; recorded in the audit log. */
export async function deviceSeedAction() { return run((c) => deviceSeed(c)); }

/**
 * DriveDB phase 2: a short-lived pass for this device to read and write the pharmacy's DriveDB folder in Google
 * Drive directly. Owner only in the pilot (staff devices come with phase 4). Data never passes through Medoro.
 */
export async function driveAccessAction() {
  return run(async (c) => {
    if (c.realRole !== "Owner" || c.role !== "Owner") throw new UserError("Only the owner’s device can connect to Google Drive in the pilot.");
    if (!(await driveModeOn(c.tenantId))) throw new UserError("Turn on Drive mode first.");
    if (!(await deviceDriveEnabled(c.tenantId))) throw new UserError("Connect Google Drive on the Backup page first.");
    return deviceDriveAccess(c.tenantId);
  });
}
