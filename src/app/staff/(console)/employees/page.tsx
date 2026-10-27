import { requireStaff } from "@/staff/auth";
import { listEmployees } from "@/staff/people";
import { EmployeesView } from "./view";

export default async function Page() {
  const s = await requireStaff(["super_admin"]);
  const rows = (await listEmployees()).map((e) => ({ ...e, bonusPct: Number(e.bonusPct) }));
  return <EmployeesView meId={s.id} rows={rows} />;
}
