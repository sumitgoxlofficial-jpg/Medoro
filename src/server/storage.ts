import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { db } from "./db";

// Files (invoice scans, backups) live in one of:
//  - a private Supabase Storage bucket, when SUPABASE_URL and SUPABASE_SECRET_KEY are set;
//  - the database (FileObject table), when STORAGE_BACKEND=database or on Vercel without a bucket,
//    since serverless disks don't persist;
//  - this server's disk (STORAGE_DIR), for self-hosted installs.
// Keys are "<tenantId>/<kind>/<file>".
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
    const data = { tenantId: k.split("/")[0], contentType, bytes: new Uint8Array(bytes) };
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
    return f ? Buffer.from(f.bytes) : null;
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

export async function saveDocument(tenantId: string, bytes: Buffer, mime: keyof typeof ALLOWED) {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const rel = `${tenantId}/scans/${sha256}.${ALLOWED[mime]}`;
  await putObject(rel, bytes, mime);
  return { sha256, rel };
}

export async function readDocument(rel: string) {
  const b = await getObject(rel);
  if (!b) throw new Error("Document not found");
  return b;
}

/** Checks magic bytes so a renamed file can't pose as a PDF or image. */
export function sniff(b: Buffer): keyof typeof ALLOWED | null {
  if (b.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP") return "image/webp";
  return null;
}
