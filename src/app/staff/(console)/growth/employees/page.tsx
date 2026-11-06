import { requireGrowth } from "@/staff/growth/access";
import { members, pendingEmployees } from "@/staff/growth/team";
import { EmployeesView } from "./view";

export default async function Employees() {
  const a = await requireGrowth("targets.set");
  const [m, pending] = await Promise.all([members(a), a.growthRole === "admin" ? pendingEmployees(a) : Promise.resolve([])]);
  return <EmployeesView m={JSON.parse(JSON.stringify(m))} pending={JSON.parse(JSON.stringify(pending))} admin={a.growthRole === "admin"} />;
}
