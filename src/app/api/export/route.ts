import { limited, userKey } from "@/server/ratelimit";
import { counted } from "@/server/metrics";
import { getCtx } from "@/server/context";
import { exportCsvFiles, fullExport } from "@/domain/system/privacy";
import { UserError } from "@/server/action";
import { zip } from "@/lib/zip";

/** Full export as JSON, or as a ZIP with one CSV per table (?format=csv). `reason` unmasks customer phones in strict mode. */
export const GET = counted("export", async (req: Request) => {
  const ctx = await getCtx();
  if (ctx?.readOnly) return new Response("Medoro support access is read-only.", { status: 403 });
  if (!ctx) return new Response("Sign in first", { status: 401 });
  if (!ctx.perms.includes("users")) return new Response("Only the owner can export all data.", { status: 403 });
  const slow = await limited("fullExport", userKey(ctx));
  if (slow) return slow;
  const q = new URL(req.url).searchParams;
  const format = q.get("format") === "csv" ? "csv" : "json";
  const day = new Date().toISOString().slice(0, 10);
  let data;
  try { data = await fullExport(ctx, { reason: q.get("reason") ?? undefined }, format); }
  catch (e) { if (e instanceof UserError) return new Response(e.message, { status: 400 }); throw e; }
  const headers = { "Cache-Control": "no-store" };
  if (format === "csv") {
    return new Response(new Uint8Array(zip(exportCsvFiles(data))), { headers: { ...headers, "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="medoro-export-${day}.zip"` } });
  }
  const body = JSON.stringify(data, (_, v) => (typeof v === "bigint" ? Number(v) : v instanceof Uint8Array ? undefined : v), 2);
  return new Response(body, { headers: { ...headers, "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="medoro-export-${day}.json"` } });
});
