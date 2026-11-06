import { growthApi, query } from "@/staff/growth/api";
import { dashboard, trends } from "@/staff/growth/analytics";

export const dynamic = "force-dynamic";
export const GET = (req: Request) => growthApi(req, "analytics.view", async (a) => { const q = query(req); return { ...(await dashboard(a, q)), trends: await trends(a, { state: q.state }) }; });
