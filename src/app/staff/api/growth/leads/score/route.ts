import { z } from "zod";
import { body, growthApi } from "@/staff/growth/api";
import { rescoreLeads } from "@/staff/growth/leads";

export const dynamic = "force-dynamic";
export const POST = (req: Request) => growthApi(req, "leads.verify", async (a) => ({ rescored: await rescoreLeads(a, (await body(req, z.object({ leadIds: z.array(z.string().uuid()).min(1).max(500) }))).leadIds) }));
