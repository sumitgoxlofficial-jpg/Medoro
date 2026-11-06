import { body, growthApi } from "@/staff/growth/api";
import { liftSuppression, suppress } from "@/staff/growth/compliance";

export const dynamic = "force-dynamic";
/** Add { value, channel, reason, leadId? }, or { liftId, note } (compliance admins) to lift one. */
export const POST = (req: Request) => growthApi(req, "consent.record", async (a) => {
  const b = await body<Record<string, unknown>>(req);
  if (b.liftId) { await liftSuppression(a, String(b.liftId), String(b.note ?? "")); return {}; }
  return { id: await suppress(a, b as never) };
});
