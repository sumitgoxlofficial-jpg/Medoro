import { afterEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { backupNow, prepareRestore, scheduledTick } from "@/domain/system/backup";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

describe("no server backups on Medoro's online server (Vercel): data is kept in each pharmacy's Google Drive", () => {
  afterEach(() => { delete process.env.VERCEL; });

  it("refuses manual backups and restores, and the scheduler skips every pharmacy", async () => {
    await resetDb(); await makePharmacy();
    const ctx = await ctxFor();
    process.env.VERCEL = "1";
    await expect(backupNow(ctx)).rejects.toThrow(/online server keeps no backups/);
    await expect(prepareRestore(ctx, "any")).rejects.toThrow(/doesn’t restore server backups/);
    await scheduledTick(new Date(), { daily: true });
    expect(await db.backupManifest.count()).toBe(0);
  });
});
