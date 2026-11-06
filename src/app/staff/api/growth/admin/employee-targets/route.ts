import { body, growthApi } from "@/staff/growth/api";
import { setTarget } from "@/staff/growth/team";

export const dynamic = "force-dynamic";
export const POST = (req: Request) => growthApi(req, "targets.set", async (a) => ({ id: await setTarget(a, await body(req) as never) }));
