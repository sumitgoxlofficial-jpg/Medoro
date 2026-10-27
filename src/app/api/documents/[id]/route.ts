import { getCtx } from "@/server/context";
import { db } from "@/server/db";
import { readDocument } from "@/server/storage";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx || !ctx.perms.includes("purchase")) return new Response("Not found", { status: 404 });
  const { id } = await params;
  const d = await db.scanDocument.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!d?.storagePath) return new Response("Not found", { status: 404 });
  const bytes = await readDocument(d.storagePath);
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": d.mime ?? "application/octet-stream", "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff", "Content-Disposition": `inline; filename="${d.fileName.replace(/[^\w.-]/g, "_")}"` } });
}
