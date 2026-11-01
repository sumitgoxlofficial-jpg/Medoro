import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "./db";
import { driveConfigured, driveDownload, driveUpload, tenantDrive } from "@/domain/system/gdrive";

// Files (invoice scans, backups) live in one of:
//  - a private Supabase Storage bucket, when SUPABASE_URL and SUPABASE_SECRET_KEY are set;
//  - the database (FileObject table), when STORAGE_BACKEND=database or on Vercel without a bucket,
//    since serverless disks don't persist;
//  - this server's disk (STORAGE_DIR), for self-hosted installs.
// Keys are "<tenantId>/<kind>/<file>".
// Uploaded documents can instead go to the pharmacy's Google Drive (Backup & restore → Uploaded files); a FileObject
// row without bytes then records the Drive file id, and reads stream it back from Drive.
const ROOT = path.resolve(process.env.STORAGE_DIR ?? "./storage");
export const ALLOWED = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;
// Vercel caps request bodies at 4.5 MB.
export const MAX_BYTES = (process.env.VERCEL ? 4 : 10) * 1024 * 1024;
export const MAX_LABEL = process.env.VERCEL ? "4 MB" : "10 MB";

const sb = () => {
  const url = process.env.SUPABASE_URL?.replace(/\/$/, ""), key = process.env.SUPABASE_SECRET_KEY;
  return url && key ? { url, key, bucket: process.env.SUPABASE_STORAGE_BUCKET || "medoro-private" } : null;
};
export const storageKind = () => (sb() ? "supabase" : process.env.STORAGE_BACKEND === "database" || process.env.VERCEL ? "database" : "disk");
const headers = (key: string, extra: Record<string, string> = {}) => ({ apikey: key, ...(key.startsWith("eyJ") ? { Authorization: `Bearer ${key}` } : {}), ...extra });
const safe = (key: string) => {
  const k = key.split(path.sep).join("/");
  if (!/^[A-Za-z0-9_-]+(\/[A-Za-z0-9._-]+)+$/.test(k) || k.includes("..")) throw new Error("Bad storage key");
  return k;
};

let bucketReady: Promise<void> | null = null;
function ensureBucket(c: NonNullable<ReturnType<typeof sb>>) {
  return (bucketReady ??= (async () => {
    const r = await fetch(`${c.url}/storage/v1/bucket/${c.bucket}`, { headers: headers(c.key), signal: AbortSignal.timeout(15_000) });
    if (r.ok) return;
    const m = await fetch(`${c.url}/storage/v1/bucket`, { method: "POST", headers: headers(c.key, { "Content-Type": "application/json" }), body: JSON.stringify({ id: c.bucket, name: c.bucket, public: false }), signal: AbortSignal.timeout(15_000) });
    if (!m.ok && m.status !== 409) throw new Error(`Storage bucket ${c.bucket} could not be created (${m.status}).`);
  })().catch((e) => { bucketReady = null; throw e; }));
}

export async function putObject(key: string, bytes: Buffer, contentType = "application/octet-stream") {
  const k = safe(key), c = sb();
  if (storageKind() === "database") {
    const data = { tenantId: k.split("/")[0], contentType, bytes: new Uint8Array(bytes), driveFileId: null };
    await db.fileObject.upsert({ where: { key: k }, create: { key: k, ...data }, update: data });
    return;
  }
  if (!c) {
    await mkdir(path.dirname(path.join(ROOT, k)), { recursive: true });
    await writeFile(path.join(ROOT, k), bytes, { mode: 0o600 });
    return;
  }
  await ensureBucket(c);
  const r = await fetch(`${c.url}/storage/v1/object/${c.bucket}/${k}`, { method: "POST", headers: headers(c.key, { "Content-Type": contentType, "x-upsert": "true" }), body: new Uint8Array(bytes), signal: AbortSignal.timeout(60_000) });
  if (!r.ok) throw new Error(`Storage upload failed (${r.status}).`);
}

/** The object's bytes, or null if it doesn't exist. */
export async function getObject(key: string): Promise<Buffer | null> {
  const k = safe(key), c = sb();
  if (storageKind() === "database") {
    const f = await db.fileObject.findUnique({ where: { key: k } });
    return f?.bytes ? Buffer.from(f.bytes) : null;
  }
  if (!c) {
    const full = path.resolve(ROOT, k);
    if (!full.startsWith(ROOT + path.sep)) throw new Error("Bad path");
    return readFile(full).catch(() => null);
  }
  const r = await fetch(`${c.url}/storage/v1/object/${c.bucket}/${k}`, { headers: headers(c.key), signal: AbortSignal.timeout(60_000) });
  if (r.status === 404 || r.status === 400) return null;
  if (!r.ok) throw new Error(`Storage download failed (${r.status}).`);
  return Buffer.from(await r.arrayBuffer());
}

export async function deleteObject(key: string) {
  const k = safe(key), c = sb();
  if (storageKind() === "database") { await db.fileObject.deleteMany({ where: { key: k } }); return; }
  if (!c) { await rm(path.join(ROOT, k), { force: true }); return; }
  await fetch(`${c.url}/storage/v1/object/${c.bucket}`, { method: "DELETE", headers: headers(c.key, { "Content-Type": "application/json" }), body: JSON.stringify({ prefixes: [k] }), signal: AbortSignal.timeout(15_000) });
}

export type FileStore = "server" | "gdrive";
export async function fileStore(tenantId: string): Promise<FileStore> {
  const t = await db.tenant.findUnique({ where: { id: tenantId }, select: { settings: true } });
  // Google Drive unless the pharmacy chose this server: their files belong in their own Drive.
  return (t?.settings as { backup?: { files?: FileStore } } | undefined)?.backup?.files === "server" ? "server" : "gdrive";
}

/** Saves an uploaded document where the pharmacy chose. If Drive is chosen but unreachable, it's kept on the server. */
export async function saveDocument(tenantId: string, bytes: Buffer, mime: keyof typeof ALLOWED) {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const rel = `${tenantId}/scans/${sha256}.${ALLOWED[mime]}`;
  if ((await fileStore(tenantId)) === "gdrive" && (await driveConfigured(tenantId))) {
    try {
      const have = await db.fileObject.findUnique({ where: { key: rel }, select: { driveFileId: true } });
      const driveFileId = have?.driveFileId ?? await driveUpload(tenantId, "files", rel.split("/").pop()!, bytes, { mimeType: mime, appProperties: { medoroKind: "file", medoroTenant: tenantId } });
      await db.fileObject.upsert({ where: { key: rel }, create: { key: rel, tenantId, contentType: mime, driveFileId }, update: { driveFileId } });
      return { sha256, rel, store: "gdrive" as const };
    } catch (e) {
      console.warn("[storage] Drive upload failed, keeping the file on the server:", e instanceof Error ? e.message : e);
    }
  }
  await putObject(rel, bytes, mime);
  return { sha256, rel, store: "server" as const };
}

/**
 * Moves uploaded files this server still holds (added while Drive was unreachable) into the pharmacy's Drive,
 * then drops the server copy. Only when the pharmacy keeps files in Drive.
 */
export async function moveFilesToDrive(tenantId: string, limit = 50) {
  if ((await fileStore(tenantId)) !== "gdrive" || !(await driveConfigured(tenantId))) return 0;
  const rows = await db.fileObject.findMany({ where: { tenantId, driveFileId: null, bytes: { not: null }, key: { contains: "/scans/" } }, take: limit });
  let moved = 0;
  for (const r of rows) {
    const driveFileId = await driveUpload(tenantId, "files", r.key.split("/").pop()!, Buffer.from(r.bytes!), { mimeType: r.contentType, appProperties: { medoroKind: "file", medoroTenant: tenantId } });
    await db.fileObject.update({ where: { key: r.key }, data: { driveFileId, bytes: null } });
    moved++;
  }
  return moved;
}

export async function readDocument(rel: string) {
  const k = safe(rel);
  const m = await db.fileObject.findUnique({ where: { key: k }, select: { tenantId: true, driveFileId: true } });
  if (m?.driveFileId) {
    const local = await getObject(k).catch(() => null);
    if (local) return local;
    try { return await driveDownload(tenantDrive(m.tenantId), m.driveFileId); }
    catch (e) { throw new Error(`This file is kept in Google Drive, which couldn’t be reached: ${e instanceof Error ? e.message : "unknown error"}`); }
  }
  const b = await getObject(k);
  if (!b) throw new Error("Document not found");
  return b;
}

/** Writes a file from a backup back to this server's storage (a Drive copy, if any, is no longer used). */
export async function restoreFile(key: string, bytes: Buffer, contentType: string) {
  const k = safe(key);
  await db.fileObject.deleteMany({ where: { key: k, bytes: null } });
  await putObject(k, bytes, contentType);
}

/** Checks magic bytes so a renamed file can't pose as a PDF or image. */
export function sniff(b: Buffer): keyof typeof ALLOWED | null {
  if (b.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP") return "image/webp";
  return null;
}
