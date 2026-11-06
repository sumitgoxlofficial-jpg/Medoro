import { z } from "zod";
import { body, growthApi } from "@/staff/growth/api";
import { launchCall } from "@/staff/growth/calls";

export const dynamic = "force-dynamic";
/** → { success, callSessionId, phone, dialerUri: "tel:+91…" }. Open dialerUri on the phone; then POST the report. */
export const POST = (req: Request) => growthApi(req, "calls.make", async (a) => {
  const r = await launchCall(a, (await body(req, z.object({ leadId: z.string().uuid() }))).leadId);
  return { callSessionId: r.callSessionId, phone: r.phone, dialerUri: r.dialerUri, reused: r.reused };
});
