import { limited, userKey } from "@/server/ratelimit";
import { counted } from "@/server/metrics";
import { getCtx } from "@/server/context";
import { fullExport } from "@/domain/system/privacy";

export const GET = counted("export", async () => {
  const ctx = await getCtx();
  if (ctx?.readOnly) return new Response("Medoro support access is read-only.", { status: 403 });
  if (!ctx) return new Response("Sign in first", { status: 401 });
  if (!ctx.perms.includes("users")) return new Response("Only the owner can export all data.", { status: 403 });
  const slow = await limited("fullExport", userKey(ctx));
  if (slow) return slow;
  const data = await fullExport(ctx);
  const body = JSON.stringify(data, (_, v) => (typeof v === "bigint" ? Number(v) : v instanceof Uint8Array ? undefined : v), 2);
  return new Response(body, { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="medoro-export-${new Date().toISOString().slice(0, 10)}.json"`, "Cache-Control": "no-store" } });
});
