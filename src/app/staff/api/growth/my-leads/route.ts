import { growthApi, query } from "@/staff/growth/api";
import { myLeads } from "@/staff/growth/analytics";

export const dynamic = "force-dynamic";
export const GET = (req: Request) => growthApi(req, "calls.make", (a) => myLeads(a, query(req)));
