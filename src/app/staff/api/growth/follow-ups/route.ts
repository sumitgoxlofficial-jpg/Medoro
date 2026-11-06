import { body, growthApi, query } from "@/staff/growth/api";
import { createFollowUp, listFollowUps } from "@/staff/growth/followups";

export const dynamic = "force-dynamic";
export const GET = (req: Request) => growthApi(req, "calls.make", (a) => listFollowUps(a, query(req)));
export const POST = (req: Request) => growthApi(req, "calls.make", async (a) => ({ id: await createFollowUp(a, await body(req) as never) }));
