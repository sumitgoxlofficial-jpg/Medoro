import { growthApi } from "@/staff/growth/api";
import { myDashboard } from "@/staff/growth/analytics";

export const dynamic = "force-dynamic";
export const GET = (req: Request) => growthApi(req, "calls.make", (a) => myDashboard(a));
