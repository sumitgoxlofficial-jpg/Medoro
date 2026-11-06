import { body, growthApi } from "@/staff/growth/api";
import { updateFollowUp } from "@/staff/growth/followups";

export const dynamic = "force-dynamic";
export const PATCH = async (req: Request, { params }: { params: Promise<{ id: string }> }) => growthApi(req, "calls.make", async (a) => { await updateFollowUp(a, (await params).id, await body(req) as never); return {}; });
