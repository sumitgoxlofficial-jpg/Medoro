import "server-only";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

// Uploaded documents live on the pharmacy's own server (STORAGE_DIR), never with Medoro.
const ROOT = path.resolve(process.env.STORAGE_DIR ?? "./storage");
export const ALLOWED = { "application/pdf": "pdf", "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" } as const;
export const MAX_BYTES = 10 * 1024 * 1024;

export async function saveDocument(tenantId: string, bytes: Buffer, mime: keyof typeof ALLOWED) {
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const rel = path.join(tenantId, "scans", `${sha256}.${ALLOWED[mime]}`);
  await mkdir(path.dirname(path.join(ROOT, rel)), { recursive: true });
  await writeFile(path.join(ROOT, rel), bytes, { mode: 0o600 });
  return { sha256, rel };
}

export async function readDocument(rel: string) {
  const full = path.resolve(ROOT, rel);
  if (!full.startsWith(ROOT + path.sep)) throw new Error("Bad path");
  return readFile(full);
}

/** Checks magic bytes so a renamed file can't pose as a PDF or image. */
export function sniff(b: Buffer): keyof typeof ALLOWED | null {
  if (b.subarray(0, 5).toString() === "%PDF-") return "application/pdf";
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return "image/png";
  if (b.subarray(0, 4).toString() === "RIFF" && b.subarray(8, 12).toString() === "WEBP") return "image/webp";
  return null;
}
