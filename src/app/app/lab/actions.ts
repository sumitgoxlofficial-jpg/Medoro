"use server";
import { run, UserError } from "@/server/action";
import { writeAudit } from "@/server/audit";
import { db } from "@/server/db";
import { driveConfigured, deviceDriveToken } from "@/domain/system/gdrive";

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
