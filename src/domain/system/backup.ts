import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorize, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { fingerprint, unseal } from "@/server/vault";
import { deleteObject, getObject, putObject } from "@/server/storage";
import { BACKUP_FORMAT, dropSchema, dumpForBackup, isRestorable, prepare, swapIn, type RestoreSummary } from "./restore";
import { driveUpload, driveConfigured } from "./gdrive";

const MAGIC = Buffer.from("MEDORO-BACKUP-1\n");
const SCHEMA = BACKUP_FORMAT;
const json = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x instanceof Uint8Array ? undefined : x));

async function masterKey(tenantId: string) {
  const i = await db.integration.findUnique({ where: { tenantId_kind: { tenantId, kind: "backup_key" } } });
  if (!i?.encryptedSecret) throw new UserError("No backup key on this server. It is created during setup.");
  return unseal(i.encryptedSecret);
}

/** File = MAGIC | u32 header length | header JSON | ciphertext. A fresh data key per backup, wrapped by the master key. */
export function encryptBackup(plain: Buffer, master: Buffer, meta: Record<string, unknown>) {
  const dataKey = randomBytes(32), iv = randomBytes(12), wiv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", dataKey, iv);
  const body = Buffer.concat([c.update(gzipSync(plain)), c.final()]);
  const w = createCipheriv("aes-256-gcm", master, wiv);
  const wrapped = Buffer.concat([w.update(dataKey), w.final()]);
  const header = Buffer.from(JSON.stringify({ ...meta, alg: "AES-256-GCM", compression: "gzip", iv: iv.toString("base64"), tag: c.getAuthTag().toString("base64"), wrappedKey: wrapped.toString("base64"), wrapIv: wiv.toString("base64"), wrapTag: w.getAuthTag().toString("base64"), keyFingerprint: fingerprint(master) }));
  const len = Buffer.alloc(4); len.writeUInt32BE(header.length);
  return Buffer.concat([MAGIC, len, header, body]);
}

export function decryptBackup(file: Buffer, master: Buffer) {
  if (!file.subarray(0, MAGIC.length).equals(MAGIC)) throw new Error("Not a Medoro backup file.");
  const hl = file.readUInt32BE(MAGIC.length);
  const header = JSON.parse(file.subarray(MAGIC.length + 4, MAGIC.length + 4 + hl).toString());
  const w = createDecipheriv("aes-256-gcm", master, Buffer.from(header.wrapIv, "base64"));
  w.setAuthTag(Buffer.from(header.wrapTag, "base64"));
  const dataKey = Buffer.concat([w.update(Buffer.from(header.wrappedKey, "base64")), w.final()]); // throws on a wrong key
  const d = createDecipheriv("aes-256-gcm", dataKey, Buffer.from(header.iv, "base64"));
  d.setAuthTag(Buffer.from(header.tag, "base64"));
  const plain = gunzipSync(Buffer.concat([d.update(file.subarray(MAGIC.length + 4 + hl)), d.final()]));
  return { header, data: JSON.parse(plain.toString()) as Record<string, unknown> };
}

/** Row counts per table. Older (v1) backups were exports with top-level arrays; v2 keeps raw rows under `tables`. */
const counts = (d: Record<string, unknown>) => Object.fromEntries(Object.entries((d.tables as Record<string, unknown>) ?? d).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, (v as unknown[]).length]));
const len = (d: Record<string, unknown>, v2: string, v1: string) => (((d.tables as Record<string, unknown[]>)?.[v2] ?? d[v1]) as unknown[] | undefined)?.length ?? 0;

/** Takes a backup now. Used by "Back up now" and the daily scheduler. */
export async function runBackup(tenantId: string, kind: "manual" | "scheduled" | "retry", user?: { id: string; name: string }) {
  const m = await db.backupManifest.create({ data: { tenantId, kind, schemaVersion: SCHEMA, status: "running" } });
  try {
    const master = await masterKey(tenantId);
    const data = await dumpForBackup(tenantId);
    const rowCounts = counts(data as unknown as Record<string, unknown>);
    const file = encryptBackup(Buffer.from(json(data)), master, { tenantId, manifestId: m.id, createdAt: m.startedAt.toISOString(), schemaVersion: SCHEMA, rowCounts });
    const sha256 = createHash("sha256").update(file).digest("hex");
    const name = `${m.startedAt.toISOString().replace(/[:.]/g, "-")}.mdrbak`;
    const rel = `${tenantId}/backups/${name}`;
    await putObject(rel, file);
    // Verify by reading the file back and decrypting it.
    const stored = await getObject(rel);
    if (!stored) throw new Error("Verification failed: the backup file couldn’t be read back.");
    const back = decryptBackup(stored, master);
    if (JSON.stringify(counts(back.data)) !== JSON.stringify(rowCounts)) throw new Error("Verification failed: row counts differ after decrypting.");
    let driveFileId: string | null = null, note: string | null = null;
    if (await driveConfigured(tenantId)) {
      try { driveFileId = await driveUpload(tenantId, name, file); } catch (e) { note = `Saved on server; Drive upload failed: ${e instanceof Error ? e.message : "unknown error"}`; }
    }
    await db.backupManifest.update({ where: { id: m.id }, data: { finishedAt: new Date(), sizeBytes: BigInt(file.length), sha256, driveFileId, status: note ? "partial" : "verified", error: note, rowCounts, localPath: rel } });
    await writeAudit(db, { tenantId, userId: user?.id ?? null, userName: user?.name ?? "Scheduler", action: "Backup completed", entity: "backup", entityId: m.id, detail: `${kind} · ${(file.length / 1048576).toFixed(1)} MB · ${driveFileId ? "Drive + server" : "server only"}` });
    await prune(tenantId);
    return { id: m.id, size: file.length, drive: !!driveFileId, note };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Backup failed.";
    await db.backupManifest.update({ where: { id: m.id }, data: { finishedAt: new Date(), status: "failed", error: msg.slice(0, 300) } });
    await writeAudit(db, { tenantId, userId: user?.id ?? null, userName: user?.name ?? "Scheduler", action: "Backup failed", entity: "backup", entityId: m.id, detail: msg.slice(0, 200) });
    throw e instanceof UserError ? e : new UserError(msg);
  }
}

export async function backupNow(ctx: Ctx) {
  authorize(ctx, "integrations");
  const running = await db.backupManifest.findFirst({ where: { tenantId: ctx.tenantId, status: "running", startedAt: { gt: new Date(Date.now() - 15 * 60_000) } } });
  if (running) throw new UserError("A backup is already running.");
  return runBackup(ctx.tenantId, "manual", { id: ctx.userId, name: ctx.userName });
}

async function openBackup(ctx: Ctx, id: string) {
  const m = await db.backupManifest.findFirst({ where: { id, tenantId: ctx.tenantId } });
  const rel = m?.localPath;
  if (!m || !rel) throw new UserError("Backup file not found on this server.");
  const file = await getObject(rel).catch(() => null);
  if (!file) throw new UserError("The backup file has been removed by retention or moved.");
  if (createHash("sha256").update(file).digest("hex") !== m.sha256) throw new UserError("Checksum mismatch: the file has changed since it was written.");
  return { m, ...decryptBackup(file, await masterKey(ctx.tenantId)) };
}

const RESTORE_HOURS = 24;

/** Step 1 of a restore: load the backup into a test copy and compare it with live data. Live data is untouched. */
export async function prepareRestore(ctx: Ctx, id: string) {
  authorize(ctx, "users");
  const { m, data } = await openBackup(ctx, id);
  if (!isRestorable(data)) throw new UserError("This backup was made before full restores were supported. It can still be test-restored and downloaded; take a new backup to be able to restore.");
  for (const old of await db.restoreRun.findMany({ where: { tenantId: ctx.tenantId, status: "prepared" } })) await discardRun(old.id, old.schemaName);
  const { schema, summary } = await prepare(ctx.tenantId, data, m.startedAt.toISOString());
  const run = await db.restoreRun.create({ data: { tenantId: ctx.tenantId, manifestId: m.id, schemaName: schema, status: "prepared", summary: summary as object, createdBy: ctx.userName } });
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Restore prepared", entity: "backup", entityId: m.id, detail: `Test copy of the ${m.startedAt.toISOString().slice(0, 16).replace("T", " ")} UTC backup; live data unchanged` });
  return { runId: run.id, summary };
}

async function discardRun(id: string, schema: string, status = "discarded") {
  await dropSchema(schema);
  await db.restoreRun.update({ where: { id }, data: { status } });
}

export async function discardRestore(ctx: Ctx, runId: string) {
  authorize(ctx, "users");
  const r = await db.restoreRun.findFirst({ where: { id: runId, tenantId: ctx.tenantId, status: "prepared" } });
  if (!r) return;
  await discardRun(r.id, r.schemaName);
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Restore discarded", entity: "backup", entityId: r.manifestId, detail: "Test copy deleted; live data unchanged" });
}

export async function pendingRestore(ctx: Ctx) {
  const r = await db.restoreRun.findFirst({ where: { tenantId: ctx.tenantId, status: "prepared", createdAt: { gt: new Date(Date.now() - RESTORE_HOURS * 3600_000) } }, orderBy: { createdAt: "desc" } });
  return r ? { runId: r.id, manifestId: r.manifestId, createdBy: r.createdBy, createdAt: r.createdAt.toISOString(), summary: r.summary as RestoreSummary } : null;
}

/**
 * Step 2: replace live data with the test copy. The owner types the pharmacy code to confirm.
 * A safety backup of current data is taken first; if it fails, nothing is changed.
 */
export async function applyRestore(ctx: Ctx, runId: string, confirmCode: string) {
  authorize(ctx, "users");
  const r = await db.restoreRun.findFirst({ where: { id: runId, tenantId: ctx.tenantId, status: "prepared" } });
  if (!r) throw new UserError("This restore was already applied or discarded. Prepare it again.");
  if (r.createdAt < new Date(Date.now() - RESTORE_HOURS * 3600_000)) { await discardRun(r.id, r.schemaName, "discarded"); throw new UserError("The test copy expired after 24 hours. Prepare the restore again."); }
  const summary = r.summary as RestoreSummary;
  if (summary.problems.length) throw new UserError("The test copy has problems (listed above). This backup can’t be restored.");
  const t = await db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
  if (String(confirmCode ?? "").trim().toUpperCase() !== t.code.toUpperCase()) throw new UserError(`Type the pharmacy code ${t.code} to confirm.`);
  const { data } = await openBackup(ctx, r.manifestId);
  if (!isRestorable(data)) throw new UserError("This backup can’t be restored.");
  const safety = await runBackup(ctx.tenantId, "manual", { id: ctx.userId, name: ctx.userName }).catch((e) => {
    throw new UserError(`The safety backup of current data failed, so nothing was restored. ${e instanceof Error ? e.message : ""}`.trim());
  });
  try {
    await swapIn(ctx, r.schemaName, data.tenant, `Restored the ${summary.backupAt.slice(0, 16).replace("T", " ")} UTC backup · safety backup ${safety.id.slice(0, 8)} taken first · ${summary.backupFigures.sales} sales, ${summary.backupFigures.medicines} medicines`);
  } catch (e) {
    await db.restoreRun.update({ where: { id: r.id }, data: { status: "failed", error: (e instanceof Error ? e.message : "failed").slice(0, 300) } });
    await dropSchema(r.schemaName);
    throw new UserError("The restore failed and was rolled back. Live data is unchanged.");
  }
  await db.restoreRun.update({ where: { id: r.id }, data: { status: "applied", appliedAt: new Date(), appliedBy: ctx.userName, safetyBackupId: safety.id } });
  await dropSchema(r.schemaName);
  return { safetyBackupId: safety.id };
}

/** Drops test copies nobody applied within a day. Called from the scheduler. */
export async function cleanupRestores() {
  for (const r of await db.restoreRun.findMany({ where: { status: "prepared", createdAt: { lt: new Date(Date.now() - RESTORE_HOURS * 3600_000) } } })) await discardRun(r.id, r.schemaName);
}

/** Test restore: decrypts into memory and checks every table against the manifest. Live data is untouched. */
export async function testRestore(ctx: Ctx, id: string) {
  authorize(ctx, "integrations");
  const m = await db.backupManifest.findFirst({ where: { id, tenantId: ctx.tenantId } });
  const rel = m?.localPath;
  if (!m || !rel) throw new UserError("Backup file not found on this server.");
  const file = await getObject(rel).catch(() => null);
  if (!file) throw new UserError("The backup file has been removed by retention or moved.");
  if (createHash("sha256").update(file).digest("hex") !== m.sha256) throw new UserError("Checksum mismatch: the file has changed since it was written.");
  const { data } = decryptBackup(file, await masterKey(ctx.tenantId));
  const expected = m.rowCounts as Record<string, number>;
  const got = counts(data);
  const mismatch = Object.keys(expected).filter((k) => expected[k] !== got[k]);
  if (mismatch.length) throw new UserError(`Tables don’t match the manifest: ${mismatch.join(", ")}.`);
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Backup test-restored", entity: "backup", entityId: id, detail: "Decrypted and verified in memory; live data unchanged" });
  return { sales: len(data, "Sale", "sales"), batches: len(data, "Batch", "batches"), vouchers: len(data, "Voucher", "vouchers"), restorable: isRestorable(data) };
}

/** The encrypted backup file for download, or null. */
export async function backupFile(ctx: Ctx, id: string) {
  authorize(ctx, "integrations");
  const m = await db.backupManifest.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!m?.localPath) return null;
  const bytes = await getObject(m.localPath).catch(() => null);
  return bytes ? { bytes, name: m.localPath.split(/[\\/]/).pop()! } : null;
}

type BackupSettings = { schedule: string; retention: number };
export async function backupSettings(tenantId: string): Promise<BackupSettings> {
  const t = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const b = (t.settings as { backup?: Partial<BackupSettings> }).backup ?? {};
  return { schedule: b.schedule ?? "02:30", retention: b.retention ?? 30 };
}

export async function saveBackupSettings(ctx: Ctx, s: BackupSettings) {
  authorize(ctx, "integrations");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.schedule) || ![7, 30, 90, 365].includes(s.retention)) throw new UserError("Invalid schedule.");
  const t = await db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
  const cur = (t.settings as { backup?: object }).backup ?? {};
  await db.tenant.update({ where: { id: ctx.tenantId }, data: { settings: { ...(t.settings as object), backup: { ...cur, ...s } } } });
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Backup schedule changed", entity: "tenant", detail: `daily ${s.schedule} · keep ${s.retention} days` });
}

/** Deletes local backup files older than the retention period; manifests stay as a record. */
export async function prune(tenantId: string) {
  const { retention } = await backupSettings(tenantId);
  const old = await db.backupManifest.findMany({ where: { tenantId, status: { in: ["verified", "partial"] }, startedAt: { lt: new Date(Date.now() - retention * 86400_000) } } });
  for (const m of old) {
    if (m.localPath) await deleteObject(m.localPath).catch(() => {});
    await db.backupManifest.update({ where: { id: m.id }, data: { status: "expired" } });
  }
}

/** Called every minute by the in-process scheduler: one scheduled backup per day after the set time (IST). */
/** `daily`: called once a day by a host cron (e.g. Vercel), so ignore each pharmacy's chosen time. */
export async function scheduledTick(now = new Date(), opts: { daily?: boolean } = {}) {
  await cleanupRestores().catch(() => {});
  const ist = new Date(now.getTime() + 330 * 60_000);
  const hhmm = ist.toISOString().slice(11, 16), day = ist.toISOString().slice(0, 10);
  const dayStart = new Date(Date.parse(day + "T00:00:00Z") - 330 * 60_000);
  for (const t of await db.tenant.findMany({ select: { id: true } })) {
    const s = await backupSettings(t.id);
    if (!opts.daily && hhmm < s.schedule) continue;
    const done = await db.backupManifest.findFirst({ where: { tenantId: t.id, kind: { in: ["scheduled", "retry"] }, startedAt: { gte: dayStart }, status: { not: "failed" } } });
    const failures = await db.backupManifest.count({ where: { tenantId: t.id, kind: { in: ["scheduled", "retry"] }, startedAt: { gte: dayStart }, status: "failed" } });
    if (done || failures >= 3) continue;
    await runBackup(t.id, failures ? "retry" : "scheduled").catch(() => {});
  }
}

