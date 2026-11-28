import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { getReadyMe } from "@/staff/hrms/auth";
import { speechDirs } from "@/staff/hrms/ai-hr/speech-files";

export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = { ".json": "application/json", ".onnx": "application/octet-stream", ".onnx_data": "application/octet-stream", ".wasm": "application/wasm", ".mjs": "text/javascript", ".txt": "text/plain; charset=utf-8" };

/**
 * The browser speech model, served from this server instead of Hugging Face / jsDelivr (AI HR Assistant → Settings →
 * "Speech model from: this server"). /staff/hrms/ai-speech/models/<org>/<model>/<file> and /staff/hrms/ai-speech/ort/<file>.
 * Signed-in HRMS users only; files are immutable, so browsers cache them for a year.
 */
export async function GET(_req: Request, { params }: { params: Promise<{ path: string[] }> }) {
  if (!(await getReadyMe())) return new Response("Sign in first.", { status: 401 });
  const parts = (await params).path ?? [];
  const dirs = speechDirs();
  const root = parts[0] === "models" ? dirs.models : parts[0] === "ort" ? dirs.runtime : null;
  const rest = parts.slice(1);
  if (!root || !rest.length || rest.some((p) => !p || p === "." || p === ".." || p.includes("\\") || p.includes("\0"))) return new Response("Not found", { status: 404 });
  const file = path.resolve(/*turbopackIgnore: true*/ root, ...rest);
  if (!file.startsWith(path.resolve(/*turbopackIgnore: true*/ root) + path.sep)) return new Response("Not found", { status: 404 });
  const ext = file.endsWith(".onnx_data") ? ".onnx_data" : path.extname(file);
  if (!TYPES[ext]) return new Response("Not found", { status: 404 });
  let size: number;
  try { const s = await stat(file); if (!s.isFile()) throw new Error(); size = s.size; } catch { return new Response("Not found", { status: 404 }); }
  const body = Readable.toWeb(createReadStream(file)) as ReadableStream;
  return new Response(body, { headers: { "Content-Type": TYPES[ext], "Content-Length": String(size), "Cache-Control": "private, max-age=31536000, immutable", "X-Content-Type-Options": "nosniff" } });
}
