import { metricsAuthorized, renderMetrics } from "@/server/metrics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Prometheus text exposition. Needs `Authorization: Bearer <METRICS_TOKEN>`; disabled when METRICS_TOKEN isn't set. */
export async function GET(req: Request) {
  if (!process.env.METRICS_TOKEN) return new Response("Not found", { status: 404 });
  if (!metricsAuthorized(req)) return new Response("Unauthorized", { status: 401, headers: { "WWW-Authenticate": 'Bearer realm="metrics"' } });
  return new Response(await renderMetrics(), { headers: { "Content-Type": "text/plain; version=0.0.4; charset=utf-8", "Cache-Control": "no-store" } });
}