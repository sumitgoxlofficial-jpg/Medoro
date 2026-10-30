import { getCtx } from "@/server/context";
import { UserError } from "@/server/action";
import { gstExport, type ExportKind } from "@/domain/gst/service";

const KINDS: ExportKind[] = ["gstr1-json", "gstr1-csv", "gstr3b-json", "gstr3b-csv", "hsn-csv", "tally-vouchers", "tally-masters"];

export async function GET(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return new Response("Sign in first", { status: 401 });
  if (ctx.readOnly) return new Response("Medoro support access is read-only and can’t download data.", { status: 403 });
  if (!ctx.perms.includes("reports")) return new Response("Your role cannot export reports.", { status: 403 });
  const { kind } = await params;
  if (!KINDS.includes(kind as ExportKind)) return new Response("Unknown export", { status: 404 });
  const q = new URL(req.url).searchParams;
  try {
    const f = await gstExport(ctx, kind as ExportKind, { gstin: q.get("gstin") ?? undefined, month: q.get("month") ?? undefined, from: q.get("from") ?? undefined, to: q.get("to") ?? undefined, scope: q.get("scope") ?? undefined });
    return new Response(f.body, { headers: { "Content-Type": f.type, "Content-Disposition": `attachment; filename="${f.name}"`, "Cache-Control": "no-store" } });
  } catch (e) {
    if (e instanceof UserError) return new Response(e.message, { status: 400 });
    throw e;
  }
}
