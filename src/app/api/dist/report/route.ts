import { getDistCtx, distView } from "@/domain/distribution/context";
import { distReport, isDistReport, reportCsv } from "@/domain/distribution/reports";
import { writeAudit } from "@/server/audit";
import { limited } from "@/server/ratelimit";
import { userKey } from "@/server/ratelimit";

export const dynamic = "force-dynamic";

/** CSV download of a distribution MIS report. */
export async function GET(req: Request) {
  const ctx = await getDistCtx();
  if (!ctx) return new Response("Sign in again.", { status: 401 });
  try { distView(ctx, "reports"); } catch { return new Response("Your role can't download reports.", { status: 403 }); }
  const block = await limited("report", userKey(ctx));
  if (block) return block;
  const u = new URL(req.url), id = u.searchParams.get("id") ?? "";
  if (!isDistReport(id)) return new Response("Unknown report.", { status: 404 });
  try {
    const r = await distReport(ctx, id, u.searchParams.get("from") ?? undefined, u.searchParams.get("to") ?? undefined);
    await writeAudit((await import("@/server/db")).db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Report downloaded", entity: "report", entityId: id, detail: r.title });
    return new Response("﻿" + reportCsv(r), { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${id}.csv"`, "cache-control": "no-store" } });
  } catch (e) {
    return new Response(e instanceof Error ? e.message : "Couldn't build the report.", { status: 400 });
  }
}
