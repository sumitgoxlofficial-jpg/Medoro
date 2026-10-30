import { getCtx } from "@/server/context";
import { db } from "@/server/db";
import { readDocument } from "@/server/storage";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (ctx?.readOnly) return new Response("Medoro support access is read-only and can’t download data.", { status: 403 });
  if (!ctx || !ctx.perms.includes("purchase")) return new Response("Not found", { status: 404 });
  const { id } = await params;
  const d = await db.scanDocument.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!d?.storagePath) return new Response("Not found", { status: 404 });
  let bytes: Buffer;
  try { bytes = await readDocument(d.storagePath); }
  catch (e) { return new Response(e instanceof Error && /Google Drive/.test(e.message) ? e.message : "File not found", { status: e instanceof Error && /Google Drive/.test(e.message) ? 502 : 404 }); }
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": d.mime ?? "application/octet-stream", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff", "Content-Disposition": `inline; filename="${d.fileName.replace(/[^\w.-]/g, "_")}"` } });
}
