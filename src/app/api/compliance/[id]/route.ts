import { limited, userKey } from "@/server/ratelimit";
import { counted } from "@/server/metrics";
import { getCtx } from "@/server/context";
import { readDocument, sniff } from "@/server/storage";
import { documentFor } from "@/domain/system/compliance";

/** A stored licence copy or inspection report. Needs a view permission and access to the branch the record belongs to. */
export const GET = counted("compliance_documents", async (_: Request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await getCtx();
  if (ctx?.readOnly) return new Response("Medoro support access is read-only and can’t download data.", { status: 403 });
  if (!ctx) return new Response("Not found", { status: 404 });
  const slow = await limited("document", userKey(ctx));
  if (slow) return slow;
  const d = await documentFor(ctx, (await params).id).catch(() => null);
  if (!d) return new Response("Not found", { status: 404 });
  let bytes: Buffer;
  try { bytes = await readDocument(d.storagePath); }
  catch (e) { const drive = e instanceof Error && /Google Drive/.test(e.message); return new Response(drive ? (e as Error).message : "File not found", { status: drive ? 502 : 404 }); }
  const type = sniff(bytes);
  return new Response(new Uint8Array(bytes), { headers: { "Content-Type": type ?? "application/octet-stream", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": `${type ? "inline" : "attachment"}; filename="${d.fileName.replace(/"/g, "")}"` } });
});
