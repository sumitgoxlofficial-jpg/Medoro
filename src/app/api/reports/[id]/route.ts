import { getCtx } from "@/server/context";
import { writeAudit } from "@/server/audit";
import { db } from "@/server/db";
import { periodOf } from "@/domain/accounting/service";
import { REPORTS, reportRows, type ReportId } from "@/domain/accounting/reports";
import { toCsv } from "@/lib/csv-format";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return new Response("Sign in first", { status: 401 });
  if (!ctx.perms.includes("reports")) return new Response("Your role cannot export reports.", { status: 403 });
  const { id } = await params;
  const def = REPORTS.find((r) => r[0] === id);
  if (!def) return new Response("Unknown report", { status: 404 });
  const p = periodOf(new URL(req.url).searchParams.get("period") ?? undefined);
  const rows = await reportRows(ctx, id as ReportId, p);
  await writeAudit(db, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: "Report exported", entity: "report", entityId: id, detail: `${def[1]} · ${p.label} · ${rows.length - 1} rows` });
  return new Response(toCsv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${id}-${ctx.branchCode.toLowerCase()}-${p.key}.csv"`, "Cache-Control": "no-store" } });
}
