import { redirect } from "next/navigation";
import { can, requireGrowth } from "@/staff/growth/access";
import { GROWTH_NAV } from "@/staff/growth/constants";

export default async function GrowthHome() {
  const a = await requireGrowth();
  const first = a.growthRole === "sales" ? "my-work" : GROWTH_NAV.find(([, , p]) => can(a, p))?.[0] ?? "my-work";
  redirect(`/staff/growth/${first}`);
}
