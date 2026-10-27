import { beforeAll, describe, expect, it } from "vitest";
import { readFile, writeFile, mkdtemp } from "node:fs/promises";
import { randomBytes } from "node:crypto";
import path from "node:path";
import os from "node:os";
import { db } from "@/server/db";
import { backupFilePath, decryptBackup, runBackup, testRestore } from "@/domain/system/backup";
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
    const file = await readFile((await backupFilePath(ctx, r.id))!);
    expect(file.includes(Buffer.from("Test Medical Store"))).toBe(false); // encrypted at rest
    expect(() => decryptBackup(file, randomBytes(32))).toThrow();
    file[file.length - 5] ^= 0xff;
    await writeFile((await backupFilePath(ctx, r.id))!, file);
    await expect(testRestore(ctx, r.id)).rejects.toThrow(/Checksum mismatch/);
    await expect(testRestore(await ctxFor("Manager"), r.id)).rejects.toThrow(/role/);
  });
});
