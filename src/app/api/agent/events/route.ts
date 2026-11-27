import { ingest } from "@/staff/hrms/workforce";
import { agentApi, json } from "../handler";

export const dynamic = "force-dynamic";

/** Up to 500 spans. 403 with a reason when nothing may be stored (tracking off, policy not accepted). */
export async function POST(req: Request) {
  return agentApi(req, async ({ device, body }) => {
    const r = await ingest(device!, body);
    return json(r, r.reason ? 403 : 200);
  });
}
