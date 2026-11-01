"use server";
import { run, UserError } from "@/server/action";
import { writeAudit } from "@/server/audit";
import { db } from "@/server/db";
import { driveConfigured, deviceDriveToken } from "@/domain/system/gdrive";
import { decideDevice, listDevices } from "@/domain/system/drivedb-relay";
import { deviceSeed, setDriveMode } from "@/domain/system/drive-mode";
import { revalidatePath } from "next/cache";
import { completeMove, moveExport, moveStatus, startMove, undoMove, type MovePart } from "@/domain/system/drive-move";

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

/** Drive mode devices of this pharmacy (owner). */
export async function driveDevicesAction() { return run((c) => listDevices(c)); }

/** Owner: approve a device (after this device gave it the keys) or remove one (after this device changed keys). */
export async function decideDriveDeviceAction(deviceId: string, approve: boolean) {
  return run((c) => decideDevice(c, deviceId, approve), approve ? "Device approved." : "Device removed.");
}

// ---------- Phase 7: moving all data from Medoro to Google Drive ----------

/** Where the move stands (null: not moved). */
export async function moveStatusAction() { return run((c) => moveStatus(c)); }

/** Freezes Medoro's copy (read-only) so this device can copy everything. Owner only. */
export async function startMoveAction() {
  const r = await run((c) => startMove(c));
  revalidatePath("/app", "layout");
  return r;
}

/** One part (or page of a part) of the pharmacy's data, for this device. */
export async function moveExportAction(part: MovePart, cursor?: string | null) { return run((c) => moveExport(c, part, cursor)); }

/** The device checked everything and saved it to Drive. */
export async function completeMoveAction(report: { device: string; checks: number }) {
  const r = await run((c) => completeMove(c, report), "Your data now lives in your Google Drive.");
  revalidatePath("/app", "layout");
  return r;
}

/** Back to Medoro's copy: during the move or within 7 days. */
export async function undoMoveAction() {
  const r = await run((c) => undoMove(c), "Medoro’s copy is in use again.");
  revalidatePath("/app", "layout");
  return r;
}
