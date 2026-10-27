import { getCtx } from "@/server/context";
import { fullExport } from "@/domain/system/privacy";

export async function GET() {
  const ctx = await getCtx();
  if (!ctx) return new Response("Sign in first", { status: 401 });
  if (!ctx.perms.includes("users")) return new Response("Only the owner can export all data.", { status: 403 });
  const data = await fullExport(ctx);
  const body = JSON.stringify(data, (_, v) => (typeof v === "bigint" ? Number(v) : v instanceof Uint8Array ? undefined : v), 2);
  return new Response(body, { headers: { "Content-Type": "application/json; charset=utf-8", "Content-Disposition": `attachment; filename="medoro-export-${new Date().toISOString().slice(0, 10)}.json"`, "Cache-Control": "no-store" } });
}
