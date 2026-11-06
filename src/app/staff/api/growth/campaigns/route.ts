import { body, growthApi } from "@/staff/growth/api";
import { campaigns, createCampaign } from "@/staff/growth/comms";

export const dynamic = "force-dynamic";
export const GET = (req: Request) => growthApi(req, "campaigns.manage", async (a) => ({ campaigns: await campaigns(a) }));
export const POST = (req: Request) => growthApi(req, "campaigns.manage", async (a) => ({ id: await createCampaign(a, await body(req) as never) }));
