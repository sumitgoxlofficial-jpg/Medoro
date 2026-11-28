import { getReadyMe } from "@/staff/hrms/auth";
import { maybeTickFromRing, nainaRing } from "@/staff/hrms/ai-hr/service";
import { defer } from "@/server/defer";

export const dynamic = "force-dynamic";

/** Asked by every HRMS page every few seconds: is Naina calling the signed-in employee right now? (Their own calls only.) */
export async function GET() {
  const me = await getReadyMe();
  if (!me) return Response.json({ error: "signed-out" }, { status: 401, headers: { "cache-control": "no-store" } });
  try {
    // While anyone has the HRMS open, the AI job runs about once a minute with no outside scheduler (after the response).
    await defer(() => maybeTickFromRing());
    return Response.json({ ring: await nainaRing(me) }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ ring: null }, { headers: { "cache-control": "no-store" } });
  }
}
