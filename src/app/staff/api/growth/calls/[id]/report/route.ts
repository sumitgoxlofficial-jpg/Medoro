import { body, growthApi } from "@/staff/growth/api";
import { reportCall } from "@/staff/growth/calls";

export const dynamic = "force-dynamic";
/** { outcome, interestLevel, notes, followUpAt?, numberConfirmed?, softwareStatus?, demo?, conversion?, idempotencyKey? }. Also accepts the Idempotency-Key header. */
export const POST = async (req: Request, { params }: { params: Promise<{ id: string }> }) => growthApi(req, "calls.make", async (a) => {
  const b = await body<Record<string, unknown>>(req);
  return reportCall(a, (await params).id, { ...b, idempotencyKey: (b.idempotencyKey as string | undefined) ?? req.headers.get("idempotency-key") ?? undefined } as never);
});
