import { beforeAll, describe, expect, it, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { db } from "@/server/db";
import { putObject } from "@/server/storage";
import { backupFile, backupSettings, decryptBackup, maybeBackup, runBackup, saveBackupSettings, scheduledTick, testRestore } from "@/domain/system/backup";
import { ctxFor, makePharmacy, resetDb } from "./helpers";

describe("encrypted backups", () => {
  beforeAll(async () => {
    process.env.STORAGE_DIR = await mkdtemp(path.join(os.tmpdir(), "medoro-test-"));
    await resetDb(); await makePharmacy();
  });

  it("writes, verifies and test-restores a backup; wrong key and tampering are caught", async () => {
    const ctx = await ctxFor();
    const r = await runBackup(ctx.tenantId, "manual", { id: ctx.userId, name: ctx.userName });
    const m = await db.backupManifest.findUniqueOrThrow({ where: { id: r.id } });
    expect(m.status).toBe("verified");
    expect((m.rowCounts as Record<string, number>).Branch).toBe(2);
    expect((await testRestore(ctx, r.id)).sales).toBe(0);
    const file = (await backupFile(ctx, r.id))!.bytes;
    expect(file.includes(Buffer.from("Test Medical Store"))).toBe(false); // encrypted at rest
    expect(() => decryptBackup(file, randomBytes(32))).toThrow();
    file[file.length - 5] ^= 0xff;
    await putObject(m.localPath!, file);
    await expect(testRestore(ctx, r.id)).rejects.toThrow(/Checksum mismatch/);
    await expect(testRestore(await ctxFor("Manager"), r.id)).rejects.toThrow(/role/);
  });

  it("scheduler: a backup stuck in running counts as failed, and parallel ticks start only one backup", async () => {
    const ctx = await ctxFor();
    await saveBackupSettings(ctx, { schedule: "00:00", retention: 30 });
    const now = new Date();
    const stuck = await db.backupManifest.create({ data: { tenantId: ctx.tenantId, kind: "scheduled", schemaVersion: "2", status: "running", startedAt: new Date(now.getTime() - 31 * 60_000) } });
    await Promise.all([scheduledTick(now), scheduledTick(now), scheduledTick(now)]);
    expect((await db.backupManifest.findUniqueOrThrow({ where: { id: stuck.id } })).status).toBe("failed");
    const started = await db.backupManifest.findMany({ where: { tenantId: ctx.tenantId, kind: { in: ["scheduled", "retry"] }, id: { not: stuck.id } } });
    expect(started).toHaveLength(1);
    expect(started[0].status).toBe("verified");
    await scheduledTick(new Date());
    expect(await db.backupManifest.count({ where: { tenantId: ctx.tenantId, kind: { in: ["scheduled", "retry"] } } })).toBe(2);
  });

  it("emails the owner when a scheduled backup fails", async () => {
    const ctx = await ctxFor();
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    process.env.MAIL_PROVIDER = "console";
    // An unreachable storage bucket makes the backup fail.
    process.env.SUPABASE_URL = "http://127.0.0.1:9"; process.env.SUPABASE_SECRET_KEY = "x";
    try {
      await expect(runBackup(ctx.tenantId, "scheduled")).rejects.toThrow();
      const mail = info.mock.calls.map((c) => String(c[0])).find((s) => s.startsWith("[mail] to owner@test.in"));
      expect(mail).toMatch(/backup failed/);
    } finally { delete process.env.SUPABASE_URL; delete process.env.SUPABASE_SECRET_KEY; delete process.env.MAIL_PROVIDER; info.mockRestore(); }
  });

  it("backs up every few hours while the pharmacy uses Medoro, when chosen", async () => {
    const ctx = await ctxFor();
    await db.backupManifest.deleteMany({ where: { tenantId: ctx.tenantId } });
    expect(await maybeBackup(ctx.tenantId)).toBeNull(); // once a day (default): nothing extra
    await saveBackupSettings(ctx, { schedule: "02:30", retention: 30, files: "server", every: 6 });
    expect((await backupSettings(ctx.tenantId)).every).toBe(6);
    await expect(saveBackupSettings(ctx, { schedule: "02:30", retention: 30, files: "server", every: 5 })).rejects.toThrow(/Invalid/);
    const first = await maybeBackup(ctx.tenantId);
    expect(first).toMatchObject({ size: expect.any(Number) });
    expect(await maybeBackup(ctx.tenantId)).toBeNull(); // just backed up
    await db.backupManifest.update({ where: { id: first!.id }, data: { startedAt: new Date(Date.now() - 7 * 3600_000) } });
    expect(await maybeBackup(ctx.tenantId)).toMatchObject({ size: expect.any(Number) });
    expect(await db.backupManifest.count({ where: { tenantId: ctx.tenantId, status: "verified" } })).toBe(2);
    // A backup already running blocks another.
    await db.backupManifest.updateMany({ where: { tenantId: ctx.tenantId }, data: { startedAt: new Date(Date.now() - 7 * 3600_000) } });
    await db.backupManifest.create({ data: { tenantId: ctx.tenantId, kind: "manual", schemaVersion: "x", status: "running" } });
    expect(await maybeBackup(ctx.tenantId)).toBeNull();
  });
});
