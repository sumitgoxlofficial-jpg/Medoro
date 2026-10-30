import { getCtx } from "@/server/context";
import { readRx } from "@/domain/orders/service";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (ctx?.readOnly) return new Response("Medoro support access is read-only and can’t download data.", { status: 403 });
  if (!ctx) return new Response("Sign in first", { status: 401 });
  const { id } = await params;
  const f = await readRx(ctx, id);
  if (!f) return new Response("Not found", { status: 404 });
  return new Response(new Uint8Array(f.bytes), { headers: { "Content-Type": f.mime, "Cache-Control": "private, max-age=3600", "X-Content-Type-Options": "nosniff", "Content-Disposition": `inline; filename="${f.name.replace(/[^\w.-]/g, "_")}"` } });
}
