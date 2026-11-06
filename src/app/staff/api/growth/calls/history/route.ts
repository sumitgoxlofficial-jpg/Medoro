import { growthApi, query } from "@/staff/growth/api";
import { callHistory } from "@/staff/growth/calls";

export const dynamic = "force-dynamic";
export const GET = (req: Request) => growthApi(req, "calls.make", (a) => callHistory(a, query(req)));
