import "server-only";
import { signupOpen } from "@/server/setup-gate";
import { TRIAL_DAYS } from "./subscription";
import { driveRequired } from "./drive-state";
import { createHash } from "node:crypto";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorize, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { fingerprint, seal, unseal } from "@/server/vault";
import { getObject, putObject } from "@/server/storage";
import { openSecret } from "@/server/totp";
import { dropSchema, isRestorable, prepare, restoreFiles, swapIn, type RestoreData } from "./restore";
import { counts, decryptBackup, encryptBackup, json, masterKey, prepareRestore, readHeader, SCHEMA } from "./backup";
import { driveDownload, saveDriveToken, tenantDrive } from "./gdrive";

// Disaster recovery: restoring a backup file that isn't in this server's history (uploaded, or picked from
// Google Drive), opened with the recovery-kit key, including onto a brand-new server with an empty database.

/** The 32-byte key from a recovery kit: paste the whole kit or just the key line. */
export function parseKit(text: string) {
  const t = String(text ?? "").trim();
  // The printable kit page (meta tag), an older text kit, the bare key, or the key as printed in groups of four.
  const m = /<meta name="medoro-recovery-key" content="([A-Za-z0-9_-]{43})">/.exec(t)
    ?? /Backup decryption key:\s*([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/.exec(t) ?? /^([A-Za-z0-9_-]{43})$/.exec(t.replace(/\s+/g, ""));
  const key = m ? Buffer.from(m[1], "base64url") : null;
  if (!key || key.length !== 32) throw new UserError("Enter the 43-character backup decryption key from the recovery kit, or paste the whole kit.");
  return key;
}

/** Decrypts a backup file with a given key, with messages a pharmacy owner can act on. */
export function openWith(file: Buffer, key: Buffer) {
  const h = readHeader(file);
  if (h.keyFingerprint && h.keyFingerprint !== fingerprint(key)) throw new UserError(`This recovery key (fingerprint ${fingerprint(key)}) doesn’t open this backup. It needs the kit with fingerprint ${h.keyFingerprint}.`);
  try { return decryptBackup(file, key); }
  catch { throw new UserError("The backup can’t be decrypted: the file is damaged or the key is wrong."); }
}

async function keyRow(tenantId: string) {
  return db.integration.findUnique({ where: { tenantId_kind: { tenantId, kind: "backup_key" } } });
}

/** Whether this server can still open its copy of the backup key. */
export async function keyHealth(tenantId: string): Promise<"ok" | "missing" | "unreadable"> {
  const i = await keyRow(tenantId);
  if (!i?.encryptedSecret) return "missing";
  try { unseal(i.encryptedSecret); return "ok"; } catch { return "unreadable"; }
}

/**
 * Re-enters the recovery kit, e.g. after HOST_KEY was lost or changed: the key is checked against the
 * fingerprint recorded at setup and sealed again with the current HOST_KEY.
 */
export async function reenterKit(ctx: Ctx, kit: string) {
  authorize(ctx, "integrations");
  const key = parseKit(kit);
  const i = await keyRow(ctx.tenantId);
  const t = await db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
  const want = (i?.config as { fingerprint?: string } | null)?.fingerprint ?? (t.settings as { backup?: { keyFingerprint?: string } }).backup?.keyFingerprint;
  if (want && want !== fingerprint(key)) throw new UserError(`This kit’s key has fingerprint ${fingerprint(key)}, but this pharmacy’s backups use ${want}. Find the kit with that fingerprint.`);
  await storeKey(ctx.tenantId, key);
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Recovery kit entered", entity: "integration", detail: `Backup key ${fingerprint(key)} sealed with this server's HOST_KEY` });
  return { fingerprint: fingerprint(key) };
}

async function storeKey(tenantId: string, key: Buffer) {
  const data = { config: { fingerprint: fingerprint(key) }, encryptedSecret: new Uint8Array(seal(key)), rotatedAt: new Date() };
  await db.integration.upsert({ where: { tenantId_kind: { tenantId, kind: "backup_key" } }, create: { tenantId, kind: "backup_key", connectedAt: new Date(), ...data }, update: data });
}

/** Keeps a copy of an outside backup in this server's history, encrypted with this server's backup key. */
async function keepCopy(tenantId: string, file: Buffer, key: Buffer, header: ReturnType<typeof readHeader>, data: RestoreData, driveFileId: string | null, master: Buffer) {
  const m = await db.backupManifest.create({ data: { tenantId, kind: "imported", schemaVersion: SCHEMA, status: "running", driveFileId } });
  const rowCounts = counts(data as unknown as Record<string, unknown>);
  const out = master.equals(key) ? file : encryptBackup(Buffer.from(json(data)), master, { tenantId, manifestId: m.id, createdAt: header.createdAt ?? data.exportedAt, schemaVersion: SCHEMA, rowCounts });
  const rel = `${tenantId}/backups/imported-${new Date().toISOString().replace(/[:.]/g, "-")}.mdrbak`;
  await putObject(rel, out);
  return db.backupManifest.update({ where: { id: m.id }, data: { finishedAt: new Date(), status: "verified", sizeBytes: BigInt(out.length), sha256: createHash("sha256").update(out).digest("hex"), localPath: rel, rowCounts } });
}

/**
 * Restore on a running pharmacy from a backup file that was uploaded or picked in Drive. Without a kit the
 * server's own copy of the key is used. The file then goes through the usual test copy → compare → confirm flow.
 */
export async function importBackup(ctx: Ctx, src: { bytes: Buffer } | { driveFileId: string }, kit?: string) {
  authorize(ctx, "users");
  if (ctx.moved) throw new UserError("This pharmacy’s data lives in its Google Drive, so a Medoro backup can’t be restored here. Restore on the counter from Google Drive instead.");
  if ("driveFileId" in src) {
    const known = await db.backupManifest.findFirst({ where: { tenantId: ctx.tenantId, driveFileId: src.driveFileId, status: { in: ["verified", "partial"] }, localPath: { not: null } }, orderBy: { startedAt: "desc" } });
    if (known && !kit?.trim() && (await getObject(known.localPath!).catch(() => null))) return prepareRestore(ctx, known.id);
  }
  const file = "bytes" in src ? src.bytes : await driveDownload(tenantDrive(ctx.tenantId), src.driveFileId);
  const kitKey = kit?.trim() ? parseKit(kit) : null;
  let master: Buffer;
  try { master = await masterKey(ctx.tenantId); }
  catch (e) {
    if (!kitKey) throw e;
    await reenterKit(ctx, kit!);
    master = kitKey;
  }
  const { header, data } = openWith(file, kitKey ?? master);
  const tenant = (data as { tenant?: { id?: string; name?: string; code?: string } }).tenant;
  if ((tenant?.id ?? header.tenantId) !== ctx.tenantId) throw new UserError(`This backup is of another pharmacy${tenant?.name ? ` (${tenant.name}, ${tenant.code})` : ""}.`);
  if (!isRestorable(data)) throw new UserError("This backup was made before full restores were supported and can’t be restored.");
  const m = await keepCopy(ctx.tenantId, file, kitKey ?? master, header, data, "driveFileId" in src ? src.driveFileId : null, master);
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Backup imported", entity: "backup", entityId: m.id, detail: `${"driveFileId" in src ? "From Google Drive" : "Uploaded file"} · made ${(header.createdAt ?? "").slice(0, 16).replace("T", " ")} UTC` });
  return prepareRestore(ctx, m.id);
}

// ───────────── New server: restore instead of setting up ─────────────

/** First-run setup (empty database), or a hosted server with self sign-up where a returning pharmacy restores. */
async function assertFresh() {
  if ((await db.tenant.count()) && !signupOpen()) throw new UserError("This installation is already set up. Sign in and restore from Backup & restore instead.");
}

/** On a server with other pharmacies: the restored pharmacy, its code and its owner's email must all be free. */
async function assertFreeForRestore(data: { tenant: { id: string; code: string }; tables: Record<string, unknown[]> }) {
  if (!(await db.tenant.count())) return;
  if (await db.tenant.findUnique({ where: { id: data.tenant.id }, select: { id: true } })) throw new UserError("This pharmacy already has an account on Medoro. Sign in instead, and restore from Backup & restore if you need older data.");
  if (await db.tenant.findUnique({ where: { code: data.tenant.code }, select: { id: true } })) throw new UserError(`The pharmacy code ${data.tenant.code} is in use by another pharmacy. Contact Medoro support to restore this backup.`);
  const emails = ((data.tables.User ?? []) as { email?: string | null }[]).map((u) => u.email?.toLowerCase()).filter((e): e is string => !!e);
  if (emails.length && (await db.user.findFirst({ where: { email: { in: emails }, role: { name: "Owner" } }, select: { id: true } }))) throw new UserError("An account with this backup’s owner email already exists. Sign in instead.");
}

function openForSetup(file: Buffer, kit: string) {
  const key = parseKit(kit);
  const { header, data } = openWith(file, key);
  if (!isRestorable(data)) throw new UserError("This backup was made before full restores were supported and can’t be restored onto a new server.");
  return { key, header, data };
}

/** What's in the backup, so the owner can check it's the right one before restoring. Nothing is written. */
export async function previewFreshRestore(file: Buffer, kit: string) {
  noServerRestore();
  await assertFresh();
  const { key, header, data } = openForSetup(file, kit);
  const n = (t: string) => (data.tables[t] ?? []).length;
  return {
    pharmacy: data.tenant.name, code: data.tenant.code, backupAt: header.createdAt ?? data.exportedAt, fingerprint: fingerprint(key),
    sales: n("Sale"), medicines: n("Medicine"), users: n("User"), branches: n("Branch"), files: data.files?.length ?? 0,
  };
}

/** On Medoro's hosted server no pharmacy's records are kept, so an old Medoro backup can't be restored onto it. */
function noServerRestore() {
  if (driveRequired()) throw new UserError("Medoro now keeps every pharmacy’s data in its own Google Drive, not on Medoro’s server, so a Medoro backup can’t be restored here. Sign in, or create a new account, and set up your counter with Google Drive.");
}

/**
 * Restores a backup onto an empty database: the pharmacy is recreated from the backup through the same test
 * copy → check → swap steps, the recovery-kit key becomes this server's backup key, and everyone signs in with
 * the accounts in the backup. Authenticator secrets that this server's HOST_KEY can't open are cleared, so
 * those people set up their authenticator again at sign-in.
 */
export async function freshRestore(file: Buffer, kit: string, confirmCode: string, drive?: { refreshToken: string; account: string } | null, driveFileId: string | null = null) {
  noServerRestore();
  await assertFresh();
  const { key, header, data } = openForSetup(file, kit);
  const tenantId = data.tenant.id, at = header.createdAt ?? data.exportedAt;
  await assertFreeForRestore(data as unknown as Parameters<typeof assertFreeForRestore>[0]);
  if (String(confirmCode ?? "").trim().toUpperCase() !== data.tenant.code.toUpperCase()) throw new UserError(`Type the pharmacy code ${data.tenant.code} to confirm.`);
  const { schema, summary } = await prepare(tenantId, data, at);
  if (summary.problems.length) { await dropSchema(schema); throw new UserError(`This backup can’t be restored: ${summary.problems.join(" ")}`); }
  try {
    await db.$transaction(async (tx) => {
      if (signupOpen() ? await tx.tenant.findFirst({ where: { OR: [{ id: tenantId }, { code: data.tenant.code }] }, select: { id: true } }) : await tx.tenant.count()) throw new UserError("This installation was set up meanwhile.");
      const t = data.tenant;
      await tx.tenant.create({ data: { id: tenantId, code: t.code, name: t.name, legalName: t.legalName, gstin: t.gstin, phone: t.phone, settings: (t.settings ?? {}) as object } });
      await tx.integration.deleteMany({ where: { tenantId } });
      await tx.integration.create({ data: { tenantId, kind: "backup_key", config: { fingerprint: fingerprint(key) }, encryptedSecret: new Uint8Array(seal(key)), connectedAt: new Date() } });
    });
  } catch (e) { await dropSchema(schema); throw e; }
  try {
    await restoreFiles(data);
    await swapIn({ tenantId, userId: null, userName: "Setup" }, schema, data.tenant, `Restored the ${at.slice(0, 16).replace("T", " ")} UTC backup onto a new server with the recovery kit · ${summary.backupFigures.sales} sales, ${summary.backupFigures.medicines} medicines`);
  } catch (e) {
    await dropSchema(schema);
    await db.integration.deleteMany({ where: { tenantId } });
    await db.tenant.delete({ where: { id: tenantId } }).catch(() => {});
    throw new UserError(`The restore failed and nothing was kept: ${e instanceof Error ? e.message.slice(0, 200) : "unknown error"}. You can try again.`);
  }
  await dropSchema(schema);
  const branches = (data.tables.Branch ?? []).length;
  await db.subscriptionMeta.create({ data: { tenantId, plan: branches > 1 ? "Multi-branch" : "Professional", addons: [], status: "trial", renewsAt: new Date(Date.now() + TRIAL_DAYS * 86400_000) } });
  const m = await keepCopy(tenantId, file, key, header, data, driveFileId, key);
  await db.restoreRun.create({ data: { tenantId, manifestId: m.id, schemaName: schema, status: "applied", summary: summary as object, createdBy: "Setup", appliedAt: new Date(), appliedBy: "Setup" } });
  let mfaReset = 0;
  for (const u of await db.user.findMany({ where: { tenantId, mfaSecret: { not: null } }, select: { id: true, mfaSecret: true } })) {
    try { openSecret(u.mfaSecret!); } catch { await db.user.update({ where: { id: u.id }, data: { mfaSecret: null, mfaEnabled: false } }); mfaReset++; }
  }
  if (drive) await saveDriveToken(tenantId, drive.refreshToken, drive.account);
  return { pharmacy: data.tenant.name, code: data.tenant.code, mfaReset, drive: !!drive };
}
