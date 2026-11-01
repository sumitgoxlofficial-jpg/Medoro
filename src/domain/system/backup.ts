import "server-only";
import { dataInDrive } from "./drive-state";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorize, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { mailEnabled, sendMail } from "@/server/mail";
import { fingerprint, reseal, unseal } from "@/server/vault";
import { deleteObject, getObject, moveFilesToDrive, putObject, type FileStore } from "@/server/storage";
import { BACKUP_FORMAT, dropSchema, dumpForBackup, isRestorable, prepare, restoreFiles, swapIn, type RestoreSummary } from "./restore";
import { driveConfigured, driveDelete, driveDownload, driveUpload, listDriveBackups, tenantDrive } from "./gdrive";
import { backupDecision, istClock, STALE_RUNNING_MS } from "./schedule";

const MAGIC = Buffer.from("MEDORO-BACKUP-1\n");
export const SCHEMA = BACKUP_FORMAT;
export const json = (v: unknown) => JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x instanceof Uint8Array ? undefined : x));

/** The backup key (the recovery-kit key), which this server keeps sealed with HOST_KEY to run backups and restores. */
export async function masterKey(tenantId: string) {
  const i = await db.integration.findUnique({ where: { tenantId_kind: { tenantId, kind: "backup_key" } } });
  if (!i?.encryptedSecret) throw new UserError("No backup key on this server. Enter the recovery kit under Backup & restore → Encryption.");
  let key: Buffer;
  try { key = unseal(i.encryptedSecret); }
  catch { throw new UserError("This server can’t open its copy of the backup key (HOST_KEY changed?). Enter the recovery kit under Backup & restore → Encryption."); }
  const again = reseal(i.encryptedSecret);
  if (again) await db.integration.update({ where: { id: i.id }, data: { encryptedSecret: new Uint8Array(again), rotatedAt: new Date() } });
  return key;
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

export type BackupHeader = { tenantId?: string; createdAt?: string; schemaVersion?: string; rowCounts?: Record<string, number>; keyFingerprint?: string; wrappedKey: string; wrapIv: string; wrapTag: string; iv: string; tag: string };

/** The unencrypted header: whose backup, when, and the fingerprint of the key that opens it. */
export function readHeader(file: Buffer): BackupHeader {
  if (file.length < MAGIC.length + 4 || !file.subarray(0, MAGIC.length).equals(MAGIC)) throw new UserError("This isn’t a Medoro backup file (.mdrbak).");
  const hl = file.readUInt32BE(MAGIC.length);
  try { return JSON.parse(file.subarray(MAGIC.length + 4, MAGIC.length + 4 + hl).toString()); }
  catch { throw new UserError("The backup file is damaged: its header can’t be read."); }
}

export function decryptBackup(file: Buffer, master: Buffer) {
  const header = readHeader(file);
  const hl = file.readUInt32BE(MAGIC.length);
  const w = createDecipheriv("aes-256-gcm", master, Buffer.from(header.wrapIv, "base64"));
  w.setAuthTag(Buffer.from(header.wrapTag, "base64"));
  const dataKey = Buffer.concat([w.update(Buffer.from(header.wrappedKey, "base64")), w.final()]); // throws on a wrong key
  const d = createDecipheriv("aes-256-gcm", dataKey, Buffer.from(header.iv, "base64"));
  d.setAuthTag(Buffer.from(header.tag, "base64"));
  const plain = gunzipSync(Buffer.concat([d.update(file.subarray(MAGIC.length + 4 + hl)), d.final()]));
  return { header, data: JSON.parse(plain.toString()) as Record<string, unknown> };
}

/** Row counts per table. Older (v1) backups were exports with top-level arrays; v2 keeps raw rows under `tables`. */
export const counts = (d: Record<string, unknown>): Record<string, number> => ({
  ...Object.fromEntries(Object.entries((d.tables as Record<string, unknown>) ?? d).filter(([, v]) => Array.isArray(v)).map(([k, v]) => [k, (v as unknown[]).length])),
  ...(d.tables && Array.isArray(d.files) ? { Files: d.files.length } : {}),
});
const len = (d: Record<string, unknown>, v2: string, v1: string) => (((d.tables as Record<string, unknown[]>)?.[v2] ?? d[v1]) as unknown[] | undefined)?.length ?? 0;

/** Takes a backup now. Used by "Back up now" and the daily scheduler (which passes the "running" manifest it claimed). */
const inDrive = async (tenantId: string) => dataInDrive((await db.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } }))?.settings);

export async function runBackup(tenantId: string, kind: "manual" | "scheduled" | "retry", user?: { id: string; name: string }, claimed?: { id: string; startedAt: Date }) {
  const m = claimed ?? await db.backupManifest.create({ data: { tenantId, kind, schemaVersion: SCHEMA, status: "running" } });
  try {
    const master = await masterKey(tenantId);
    const { data, missingFiles } = await dumpForBackup(tenantId);
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
      const appProperties = { medoroKind: "backup", medoroTenant: tenantId, medoroCode: data.tenant.code, medoroPharmacy: data.tenant.name.slice(0, 60), medoroCreatedAt: m.startedAt.toISOString() };
      try { driveFileId = await driveUpload(tenantId, "backups", name, file, { appProperties }); } catch (e) { note = `Saved on server; Drive upload failed: ${e instanceof Error ? e.message : "unknown error"}`; }
    }
    // Like WhatsApp: once the copy in the pharmacy's own Drive reads back intact, this server keeps nothing.
    // Without Drive (or if Drive fails) the server copy stays, so there is always one backup.
    let localPath: string | null = rel;
    if (driveFileId) {
      try {
        const fromDrive = await driveDownload(tenantDrive(tenantId), driveFileId);
        if (createHash("sha256").update(fromDrive).digest("hex") === sha256) { await deleteObject(rel); localPath = null; }
        else note = "Saved on server; the Drive copy didn’t match when read back.";
      } catch (e) { note = `Saved on server; couldn’t read the Drive copy back: ${e instanceof Error ? e.message : "unknown error"}`; }
    }
    if (missingFiles.length) note = `${note ? note + " " : ""}${missingFiles.length} stored file(s) couldn’t be read (Google Drive unreachable?) and aren’t in this backup.`;
    await db.backupManifest.update({ where: { id: m.id }, data: { finishedAt: new Date(), sizeBytes: BigInt(file.length), sha256, driveFileId, status: note ? "partial" : "verified", error: note, rowCounts, localPath } });
    await writeAudit(db, { tenantId, userId: user?.id ?? null, userName: user?.name ?? "Scheduler", action: "Backup completed", entity: "backup", entityId: m.id, detail: `${kind} · ${(file.length / 1048576).toFixed(1)} MB · ${localPath ? (driveFileId ? "Drive + server" : "server only") : "Google Drive only"}` });
    // Uploaded files still held here (Drive was unreachable when they were added) move to Drive too.
    if (driveFileId) await moveFilesToDrive(tenantId).catch(() => {});
    await prune(tenantId);
    return { id: m.id, size: file.length, drive: !!driveFileId, note };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Backup failed.";
    await db.backupManifest.update({ where: { id: m.id }, data: { finishedAt: new Date(), status: "failed", error: msg.slice(0, 300) } });
    await writeAudit(db, { tenantId, userId: user?.id ?? null, userName: user?.name ?? "Scheduler", action: "Backup failed", entity: "backup", entityId: m.id, detail: msg.slice(0, 200) });
    if (kind !== "manual") await alertOwners(tenantId, msg);
    throw e instanceof UserError ? e : new UserError(msg);
  }
}

/** Emails the owner when a scheduled backup fails (the bell and Backup screen show it too). */
async function alertOwners(tenantId: string, error: string) {
  if (!mailEnabled()) return;
  const [tenant, owners] = await Promise.all([
    db.tenant.findUnique({ where: { id: tenantId }, select: { name: true } }),
    db.user.findMany({ where: { tenantId, active: true, isSupport: false, role: { name: "Owner" }, email: { not: null } }, select: { email: true } }),
  ]);
  for (const o of owners) {
    await sendMail({ to: o.email!, subject: `Medoro: backup failed for ${tenant?.name ?? "your pharmacy"}`, text: `Tonight's backup didn't finish: ${error.slice(0, 300)}\n\nOpen Medoro → Backup & restore and choose "Back up now". If it fails again, check the server's storage and Google Drive connection.` }).catch(() => {});
  }
}

export async function backupNow(ctx: Ctx) {
  authorize(ctx, "integrations");
  if (await inDrive(ctx.tenantId)) throw new UserError("Your pharmacy’s data lives in your Google Drive, so Medoro has nothing to back up. Your counters save full copies to Drive.");
  const running = await db.backupManifest.findFirst({ where: { tenantId: ctx.tenantId, status: "running", startedAt: { gt: new Date(Date.now() - 15 * 60_000) } } });
  if (running) throw new UserError("A backup is already running.");
  return runBackup(ctx.tenantId, "manual", { id: ctx.userId, name: ctx.userName });
}

/** The backup file: from this server if it holds one, otherwise from the pharmacy's Google Drive. */
async function loadBackupFile(tenantId: string, m: { localPath: string | null; driveFileId: string | null }) {
  if (m.localPath) {
    const local = await getObject(m.localPath).catch(() => null);
    if (local) return local;
  }
  if (m.driveFileId && (await driveConfigured(tenantId))) {
    try { return await driveDownload(tenantDrive(tenantId), m.driveFileId); }
    catch (e) { throw new UserError(`This backup is in Google Drive, which couldn’t be reached: ${e instanceof Error ? e.message : "unknown error"}`); }
  }
  return null;
}

export async function openBackup(ctx: Ctx, id: string) {
  const m = await db.backupManifest.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!m || (!m.localPath && !m.driveFileId)) throw new UserError("Backup file not found.");
  const file = await loadBackupFile(ctx.tenantId, m);
  if (!file) throw new UserError("The backup file has been removed by retention or moved.");
  if (createHash("sha256").update(file).digest("hex") !== m.sha256) throw new UserError("Checksum mismatch: the file has changed since it was written.");
  return { m, ...decryptBackup(file, await masterKey(ctx.tenantId)) };
}

const RESTORE_HOURS = 24;

/** Step 1 of a restore: load the backup into a test copy and compare it with live data. Live data is untouched. */
export async function prepareRestore(ctx: Ctx, id: string) {
  authorize(ctx, "users");
  const { m, header, data } = await openBackup(ctx, id);
  if (!isRestorable(data)) throw new UserError("This backup was made before full restores were supported. It can still be test-restored and downloaded; take a new backup to be able to restore.");
  for (const old of await db.restoreRun.findMany({ where: { tenantId: ctx.tenantId, status: "prepared" } })) await discardRun(old.id, old.schemaName);
  const at = header.createdAt ?? m.startedAt.toISOString();
  const { schema, summary } = await prepare(ctx.tenantId, data, at);
  const run = await db.restoreRun.create({ data: { tenantId: ctx.tenantId, manifestId: m.id, schemaName: schema, status: "prepared", summary: summary as object, createdBy: ctx.userName } });
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Restore prepared", entity: "backup", entityId: m.id, detail: `Test copy of the ${at.slice(0, 16).replace("T", " ")} UTC backup; live data unchanged` });
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
  if (ctx.moved) throw new UserError("This pharmacy’s data lives in its Google Drive, so a Medoro backup can’t be restored here. Restore on the counter from Google Drive instead.");
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
    await restoreFiles(data);
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
  if (!m || (!m.localPath && !m.driveFileId)) throw new UserError("Backup file not found.");
  const file = await loadBackupFile(ctx.tenantId, m);
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
  if (!m || (!m.localPath && !m.driveFileId)) return null;
  const bytes = await loadBackupFile(ctx.tenantId, m);
  return bytes ? { bytes, name: m.localPath?.split(/[\\/]/).pop() ?? `${m.startedAt.toISOString().replace(/[:.]/g, "-")}.mdrbak` } : null;
}

/** `every`: hours between backups. 24 = once a day at `schedule`; 6 or 3 = also through the day while Medoro is in use. */
export const BACKUP_EVERY = [24, 6, 3] as const;
type BackupSettings = { schedule: string; retention: number; files: FileStore; every: (typeof BACKUP_EVERY)[number] };
export async function backupSettings(tenantId: string): Promise<BackupSettings> {
  const t = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const b = (t.settings as { backup?: Partial<BackupSettings> }).backup ?? {};
  return { schedule: b.schedule ?? "02:30", retention: b.retention ?? 30, files: b.files === "server" ? "server" : "gdrive", every: BACKUP_EVERY.includes(b.every as 24) ? b.every! : 24 };
}

export async function saveBackupSettings(ctx: Ctx, input: { schedule: string; retention: number; files?: FileStore; every?: number }) {
  authorize(ctx, "integrations");
  const t = await db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
  const cur = (t.settings as { backup?: Partial<BackupSettings> }).backup ?? {};
  const s = { schedule: input.schedule, retention: input.retention, files: input.files ?? cur.files ?? "server", every: input.every ?? cur.every ?? 24 };
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(s.schedule) || ![7, 30, 90, 365].includes(s.retention) || !["server", "gdrive"].includes(s.files) || !BACKUP_EVERY.includes(s.every as 24)) throw new UserError("Invalid schedule.");
  if (s.files === "gdrive" && cur.files !== "gdrive" && !(await driveConfigured(ctx.tenantId))) throw new UserError("Connect Google Drive first.");
  await db.tenant.update({ where: { id: ctx.tenantId }, data: { settings: { ...(t.settings as object), backup: { ...cur, ...s } } } });
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Backup schedule changed", entity: "tenant", detail: `${s.every === 24 ? "daily" : `every ${s.every} h, and daily`} ${s.schedule} · keep ${s.retention} days · new files ${s.files === "gdrive" ? "in Google Drive" : "on the server"}` });
}

/**
 * Backups through the day: when a pharmacy chose "every 6 h" or "every 3 h", a page load in the app starts one
 * (after the response) once the last good backup is that old. The host's cron only runs once a day, so use is
 * the clock. One runs at a time per pharmacy (advisory lock + a "running" manifest).
 */
export async function maybeBackup(tenantId: string, now = new Date()) {
  if (await inDrive(tenantId)) return null;
  const s = await backupSettings(tenantId);
  if (s.every === 24) return null;
  const last = await db.backupManifest.findFirst({ where: { tenantId, OR: [{ status: { in: ["verified", "partial"] } }, { status: "running", startedAt: { gt: new Date(now.getTime() - STALE_RUNNING_MS) } }] }, orderBy: { startedAt: "desc" }, select: { startedAt: true } });
  if (last && now.getTime() - last.startedAt.getTime() < s.every * 3600_000) return null;
  const claimed = await db.$transaction(async (tx) => {
    const [lock] = await tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${"backup:" + tenantId})) AS ok`;
    if (!lock?.ok) return null;
    const busy = await tx.backupManifest.findFirst({ where: { tenantId, status: "running", startedAt: { gt: new Date(now.getTime() - STALE_RUNNING_MS) } }, select: { id: true } });
    if (busy) return null;
    return tx.backupManifest.create({ data: { tenantId, kind: "scheduled", schemaVersion: SCHEMA, status: "running" } });
  }).catch(() => null);
  if (!claimed) return null;
  return runBackup(tenantId, "scheduled", undefined, claimed);
}

/**
 * Deletes backups older than the retention period, on this server and in Drive; manifests stay as a record.
 * The newest successful backup is always kept, however old, and so is the newest backup in Drive.
 */
export async function prune(tenantId: string, now = new Date()) {
  const { retention } = await backupSettings(tenantId);
  const cutoff = new Date(now.getTime() - retention * 86400_000);
  const ok = { tenantId, status: { in: ["verified", "partial"] } };
  const newest = await db.backupManifest.findFirst({ where: { ...ok, kind: { not: "imported" } }, orderBy: { startedAt: "desc" } });
  const drive = await driveConfigured(tenantId) ? tenantDrive(tenantId) : null;
  const inDrive = drive ? await listDriveBackups(drive, tenantId).catch(() => null) : null;
  const keep = new Set([newest?.driveFileId, inDrive?.[0]?.id].filter(Boolean));
  const old = await db.backupManifest.findMany({ where: { ...ok, startedAt: { lt: cutoff }, ...(newest ? { id: { not: newest.id } } : {}) } });
  for (const m of old) {
    if (m.localPath) await deleteObject(m.localPath).catch(() => {});
    if (drive && inDrive && m.driveFileId && !keep.has(m.driveFileId)) await driveDelete(drive, m.driveFileId).catch(() => {});
    await db.backupManifest.update({ where: { id: m.id }, data: { status: "expired" } });
  }
  // Drive backups this server has no record of: made by another server, or before a restore.
  for (const f of drive ? inDrive ?? [] : []) {
    if (!keep.has(f.id) && new Date(f.createdTime) < cutoff) await driveDelete(drive!, f.id).catch(() => {});
  }
}

/**
 * Marks backups that never finished (server stopped or timed out) as failed so they count as a failed attempt.
 * finishedAt stays empty: the run died at an unknown time, so the retry gap counts from its start, not from now.
 */
async function failStale(now: Date) {
  await db.backupManifest.updateMany({ where: { status: "running", startedAt: { lt: new Date(now.getTime() - STALE_RUNNING_MS) } }, data: { status: "failed", error: "Didn’t finish in time (the server stopped or timed out)." } });
}

/**
 * Called every minute by the in-process scheduler, or by a host cron (`daily`: once a day, e.g. Vercel Hobby).
 * Each tenant's decision and its "running" manifest are made under a transaction-scoped advisory lock, so
 * several app servers can't start the same backup. (A session lock would not survive a transaction-mode pooler.)
 */
export async function scheduledTick(now = new Date(), opts: { daily?: boolean } = {}) {
  await cleanupRestores().catch(() => {});
  await failStale(now).catch(() => {});
  const { hhmm, dayStart } = istClock(now);
  for (const t of await db.tenant.findMany({ select: { id: true, settings: true } })) {
    if (dataInDrive(t.settings)) continue; // the counters keep the copies, in the pharmacy's own Drive
    const s = await backupSettings(t.id);
    if (!opts.daily && hhmm < s.schedule) continue;
    const claimed = await db.$transaction(async (tx) => {
      const [lock] = await tx.$queryRaw<{ ok: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${"backup:" + t.id})) AS ok`;
      if (!lock?.ok) return null;
      const attempts = await tx.backupManifest.findMany({ where: { tenantId: t.id, kind: { in: ["scheduled", "retry"] }, startedAt: { gte: dayStart } }, select: { status: true, startedAt: true, finishedAt: true } });
      const d = backupDecision(now, s.schedule, attempts, opts.daily);
      if (!d.run) return null;
      return tx.backupManifest.create({ data: { tenantId: t.id, kind: d.kind, schemaVersion: SCHEMA, status: "running" } });
    }).catch(() => null);
    if (claimed) await runBackup(t.id, claimed.kind as "scheduled" | "retry", undefined, claimed).catch(() => {});
  }
}
