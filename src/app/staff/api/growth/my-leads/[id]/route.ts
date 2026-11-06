import { UserError } from "@/server/action";
import { growthApi } from "@/staff/growth/api";
import { leadDetail } from "@/staff/growth/leads";

export const dynamic = "force-dynamic";
export const GET = async (req: Request, { params }: { params: Promise<{ id: string }> }) => growthApi(req, "calls.make", async (a) => {
  const d = await leadDetail(a, (await params).id);
  if (d.lead.assignedStaffId !== a.id) throw new UserError("Lead not found, or it isn’t assigned to you.");
  return d;
});
