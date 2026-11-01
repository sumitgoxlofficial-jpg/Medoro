import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { setDriveMode } from "@/domain/system/drive-mode";
import { dataInDrive } from "@/domain/system/drive-state";
import { registerDevice, relay, listDevices } from "@/domain/system/drivedb-relay";
import { backupNow, maybeBackup, scheduledTick } from "@/domain/system/backup";
import { backupHealth, driveSyncHealth } from "@/domain/reports/alerts";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

const key = { kty: "RSA" as const, n: "n".repeat(342), e: "AQAB" };
const P = (o: Record<string, string>) => new URLSearchParams(o);

describe("Drive mode launch (phase 8)", () => {
  const prev = process.env.E2E_FAKE_DRIVE;
  let tenantId = "";
  beforeAll(async () => {
    process.env.E2E_FAKE_DRIVE = "1"; delete process.env.VERCEL;
    await resetDb(); await makePharmacy();
    const ctx = await ctxFor();
    tenantId = ctx.tenantId;
    await setDriveMode(ctx, true);
  });
  afterAll(() => { if (prev === undefined) delete process.env.E2E_FAKE_DRIVE; else process.env.E2E_FAKE_DRIVE = prev; });

  it("counters report each sync; the owner hears about errors and counters that stopped saving to Drive", async () => {
    const owner = await ctxFor();
    await registerDevice(owner, { deviceId: "OWN1", name: "Counter PC", publicKey: key });
    expect(await driveSyncHealth(tenantId)).toEqual([]); // just joined
    expect(await relay(owner, "OWN1", "health", P({ ok: "0", error: "Google Drive is full" }), Buffer.alloc(0))).toEqual({ ok: true });
    expect(await driveSyncHealth(tenantId)).toEqual([expect.stringMatching(/^Counter PC \(.+\) couldn’t sync with Google Drive: Google Drive is full$/)]);
    expect((await listDevices(owner))[0]).toMatchObject({ lastError: "Google Drive is full", lastSyncAt: null });
    await relay(owner, "OWN1", "health", P({ ok: "1" }), Buffer.alloc(0));
    expect(await driveSyncHealth(tenantId)).toEqual([]);
    const d = await db.driveDevice.findFirstOrThrow({ where: { tenantId } });
    expect(d.lastError).toBeNull();
    // Four days without a good sync: its bills are only on that device.
    await db.driveDevice.update({ where: { id: d.id }, data: { lastSyncAt: new Date(Date.now() - 4 * 86400_000) } });
    expect(await driveSyncHealth(tenantId)).toEqual([expect.stringMatching(/hasn’t saved to Google Drive for 4 days/)]);
  });

  it("a pharmacy whose data lives in Drive gets no server backups and no backup nagging", async () => {
    const ctx = await ctxFor();
    const later = new Date(Date.now() + 2 * 86400_000);
    expect((await backupHealth(tenantId, later)).some((p) => /backup/i.test(p))).toBe(true); // still on Medoro's server
    const t = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
    await db.tenant.update({ where: { id: tenantId }, data: { settings: { ...(t.settings as object), driveOnly: true } } });
    expect(dataInDrive((await db.tenant.findUniqueOrThrow({ where: { id: tenantId } })).settings)).toBe(true);
    await expect(backupNow(ctx)).rejects.toThrow(/nothing to back up/);
    expect(await maybeBackup(tenantId)).toBeNull();
    await scheduledTick(new Date(), { daily: true });
    expect(await db.backupManifest.count({ where: { tenantId } })).toBe(0);
    const problems = await backupHealth(tenantId, later);
    expect(problems.some((p) => /backup/i.test(p))).toBe(false);
    expect(problems).toEqual([expect.stringMatching(/hasn’t saved to Google Drive/)]);
    // Drive mode can't be switched off: there is no copy on Medoro to go back to.
    await expect(setDriveMode(ctx, false)).rejects.toThrow(/stays on/);
  });
});
