import { updateManifest } from "@/staff/hrms/workforce";
import { agentApi, json } from "../handler";

export const dynamic = "force-dynamic";

/** A signed manifest of a newer agent build, or 204 when none is offered. */
export async function GET(req: Request) {
  return agentApi(req, async () => {
    const m = await updateManifest();
    return m ? json(m) : new Response(null, { status: 204, headers: { "cache-control": "no-store" } });
  });
}
