import { assignableStaff, requireGrowth } from "@/staff/growth/access";
import { assignmentHistory, distributionOverview } from "@/staff/growth/distribution";
import { DistributionView } from "./view";

export default async function Distribution() {
  const a = await requireGrowth("assign");
  const [o, staff, hist] = await Promise.all([distributionOverview(a), assignableStaff(a), assignmentHistory(a, { take: 60 })]);
  return <DistributionView o={o} staff={staff} history={JSON.parse(JSON.stringify(hist))} admin={a.growthRole === "admin"} />;
}
