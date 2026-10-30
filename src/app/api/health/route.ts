export const dynamic = "force-dynamic";

/** Liveness: the process is up and serving. Never touches the database. */
export function GET() {
  return Response.json({ status: "ok", uptime: Math.round(process.uptime()) }, { headers: { "Cache-Control": "no-store" } });
}