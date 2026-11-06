import { body, growthApi } from "@/staff/growth/api";
import { patchAssignment } from "@/staff/growth/distribution";

export const dynamic = "force-dynamic";
export const PATCH = async (req: Request, { params }: { params: Promise<{ id: string }> }) => growthApi(req, "assign", async (a) => (await patchAssignment(a, (await params).id, await body(req) as never)) ?? {});
