import { body, growthApi } from "@/staff/growth/api";
import { leadDetail, updateLead } from "@/staff/growth/leads";

export const dynamic = "force-dynamic";
type P = { params: Promise<{ id: string }> };
export const GET = async (req: Request, { params }: P) => growthApi(req, "leads.view", async (a) => leadDetail(a, (await params).id));
export const PATCH = async (req: Request, { params }: P) => growthApi(req, "leads.edit", async (a) => { await updateLead(a, (await params).id, await body(req) as never); return {}; });
