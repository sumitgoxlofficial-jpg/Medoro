import { getCtx } from "@/server/context";
import { writeAudit } from "@/server/audit";
import { db } from "@/server/db";
import { periodOf } from "@/domain/accounting/service";
import { REPORTS, reportRows, reportScopeTag, scopeOf, type ReportId } from "@/domain/accounting/reports";
import { toCsv } from "@/lib/csv-format";
import { isManager, isStrict } from "@/domain/system/strict";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return new Response("Sign in first", { status: 401 });
  if (ctx.readOnly) return new Response("Medoro support access is read-only and can’t download data.", { status: 403 });
  if (!ctx.perms.includes("reports")) return new Response("Your role cannot export reports.", { status: 403 });
  const { id } = await params;
  const def = REPORTS.find((r) => r[0] === id);
  if (!def) return new Response("Unknown report", { status: 404 });
  const q = new URL(req.url).searchParams;
  const p = periodOf(q.get("period") ?? undefined), scope = scopeOf(q.get("scope")), tag = reportScopeTag(ctx, id as ReportId, scope);
  // Strict mode: customer phones only for the owner or a manager who records a reason (audited).
  const reason = (q.get("reason") ?? "").trim().slice(0, 120);
  const showPhones = !(await isStrict(ctx)) || (isManager(ctx) && reason.length >= 5);
  const rows = await reportRows(ctx, id as ReportId, p, scope, { showPhones });
  await writeAudit(db, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: "Report exported", entity: "report", entityId: id, detail: `${def[1]} · ${tag === "all" ? "all branches" : ctx.branchName} · ${p.label} · ${rows.length - 1} rows${id === "customer-dues" ? (showPhones ? (reason ? ` · phones included · reason: ${reason}` : "") : " · phones masked") : ""}` });
  return new Response(toCsv(rows), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="${id}-${tag}-${p.key}.csv"`, "Cache-Control": "no-store" } });
}
