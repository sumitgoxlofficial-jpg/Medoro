import { readiness } from "@/server/readiness";
import { counted } from "@/server/metrics";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Readiness: database reachable, migrations applied, required settings present. */
export const GET = counted("ready", async () => {
  const r = await readiness();
  return Response.json({ status: r.ready ? "ready" : "not_ready", ...r }, { status: r.ready ? 200 : 503, headers: { "Cache-Control": "no-store" } });
});