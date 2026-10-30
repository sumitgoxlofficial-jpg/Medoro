import { getCtx } from "@/server/context";
import { writeAudit } from "@/server/audit";
import { UserError } from "@/server/action";
import { db } from "@/server/db";
import { partyStatement, statementCsv, type PartyType } from "@/domain/parties/statement";
import { toCsv } from "@/lib/csv-format";

export async function GET(req: Request, { params }: { params: Promise<{ type: string; id: string }> }) {
  const ctx = await getCtx();
  if (!ctx) return new Response("Sign in first", { status: 401 });
  if (ctx.readOnly) return new Response("Medoro support access is read-only and can’t download data.", { status: 403 });
  const { type, id } = await params;
  if (type !== "supplier" && type !== "customer") return new Response("Unknown party type", { status: 404 });
  const q = new URL(req.url).searchParams;
  let s;
  try { s = await partyStatement(ctx, type as PartyType, id, q.get("from") ?? undefined, q.get("to") ?? undefined); }
  catch (e) {
    if (e instanceof UserError) return new Response(e.message, { status: 404 });
    if (e instanceof Error && "status" in e) return new Response(e.message, { status: 403 });
    throw e;
  }
  await writeAudit(db, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: "Statement exported", entity: type, entityId: id, detail: `${s.party.name} · ${s.fromDay} to ${s.toDay}` });
  const slug = s.party.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || type;
  return new Response(toCsv(statementCsv(s)), { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="statement-${slug}-${s.fromDay}-${s.toDay}.csv"`, "Cache-Control": "no-store" } });
}
