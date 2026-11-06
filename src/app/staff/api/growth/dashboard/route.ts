import { growthApi, query } from "@/staff/growth/api";
import { dashboard } from "@/staff/growth/analytics";

export const dynamic = "force-dynamic";
export const GET = (req: Request) => growthApi(req, "analytics.view", (a) => dashboard(a, query(req)));
