import { readFile } from "node:fs/promises";
import { getCtx } from "@/server/context";
import { writeAudit } from "@/server/audit";
import { db } from "@/server/db";
import { backupFilePath } from "@/domain/system/backup";

export async function GET(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (ctx?.readOnly) return new Response("Medoro support access is read-only.", { status: 403 });
  if (!ctx || !ctx.perms.includes("integrations")) return new Response("Forbidden", { status: 403 });
  const { id } = await params;
  const p = await backupFilePath(ctx, id).catch(() => null);
  const file = p ? await readFile(p).catch(() => null) : null;
  if (!file) return new Response("Not found", { status: 404 });
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Backup downloaded", entity: "backup", entityId: id });
  return new Response(new Uint8Array(file), { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${p!.split("/").pop()}"`, "Cache-Control": "no-store" } });
}
