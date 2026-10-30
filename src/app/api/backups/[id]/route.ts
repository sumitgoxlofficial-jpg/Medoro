import { limited, userKey } from "@/server/ratelimit";
import { counted } from "@/server/metrics";
import { getCtx } from "@/server/context";
import { writeAudit } from "@/server/audit";
import { db } from "@/server/db";
import { backupFile } from "@/domain/system/backup";

export const GET = counted("backups", async (_: Request, { params }: { params: Promise<{ id: string }> }) => {
  const ctx = await getCtx();
  if (ctx?.readOnly) return new Response("Medoro support access is read-only.", { status: 403 });
  if (!ctx || !ctx.perms.includes("integrations")) return new Response("Forbidden", { status: 403 });
  const slow = await limited("backupDownload", userKey(ctx));
  if (slow) return slow;
  const { id } = await params;
  const f = await backupFile(ctx, id).catch(() => null);
  if (!f) return new Response("Not found", { status: 404 });
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Backup downloaded", entity: "backup", entityId: id });
  return new Response(new Uint8Array(f.bytes), { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${f.name}"`, "Cache-Control": "no-store" } });
});
