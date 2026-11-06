import { requireGrowth } from "@/staff/growth/access";
import { members } from "@/staff/growth/team";
import { EmployeesView } from "./view";

export default async function Employees() {
  const a = await requireGrowth("targets.set");
  const m = await members(a);
  return <EmployeesView m={JSON.parse(JSON.stringify(m))} admin={a.growthRole === "admin"} />;
}
