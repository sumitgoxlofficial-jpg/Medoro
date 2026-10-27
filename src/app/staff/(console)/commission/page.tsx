import { db } from "@/server/db";
import { requireStaff } from "@/staff/auth";
import { getRates, getTarget } from "@/staff/sales";
import { CommissionView } from "./view";

export default async function Page() {
  await requireStaff(["super_admin"]);
  const [rates, target, sales] = await Promise.all([getRates(), getTarget(), db.staffUser.findMany({ where: { role: "sales" }, orderBy: { empNo: "asc" }, select: { id: true, name: true, team: true, status: true, bonusPct: true } })]);
  return <CommissionView rates={rates} target={target} people={sales.map((u) => ({ ...u, bonusPct: Number(u.bonusPct) }))} />;
}
