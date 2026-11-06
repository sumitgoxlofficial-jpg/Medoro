import { growthApi, query } from "@/staff/growth/api";
import { employeePerformance } from "@/staff/growth/analytics";

export const dynamic = "force-dynamic";
export const GET = (req: Request) => growthApi(req, "performance.view", (a) => employeePerformance(a, query(req)));
