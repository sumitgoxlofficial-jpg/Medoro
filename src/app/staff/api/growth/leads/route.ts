import { body, growthApi, query } from "@/staff/growth/api";
import { createLead, listLeads } from "@/staff/growth/leads";

export const dynamic = "force-dynamic";
export const GET = (req: Request) => growthApi(req, "leads.view", (a) => listLeads(a, query(req)));
export const POST = (req: Request) => growthApi(req, "leads.create", async (a) => createLead(a, await body(req) as never));
