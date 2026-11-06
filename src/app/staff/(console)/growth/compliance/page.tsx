import { can, requireGrowth } from "@/staff/growth/access";
import { complianceOverview } from "@/staff/growth/compliance";
import { ComplianceView } from "./view";

export default async function Compliance() {
  const a = await requireGrowth("compliance.view");
  const o = await complianceOverview(a);
  return <ComplianceView o={JSON.parse(JSON.stringify(o))} canManage={can(a, "compliance.manage")} />;
}
