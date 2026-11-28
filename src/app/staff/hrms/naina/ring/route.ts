import { getReadyMe } from "@/staff/hrms/auth";
import { nainaRing } from "@/staff/hrms/ai-hr/service";

export const dynamic = "force-dynamic";

/** Asked by every HRMS page every few seconds: is Naina calling the signed-in employee right now? (Their own calls only.) */
export async function GET() {
  const me = await getReadyMe();
  if (!me) return Response.json({ error: "signed-out" }, { status: 401, headers: { "cache-control": "no-store" } });
  try {
    return Response.json({ ring: await nainaRing(me) }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ ring: null }, { headers: { "cache-control": "no-store" } });
  }
}
