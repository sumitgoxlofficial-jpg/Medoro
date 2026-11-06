import { requireStaff } from "@/staff/auth";
import { badges } from "@/staff/support";
import { actorFor, can } from "@/staff/growth/access";
import { GROWTH_NAV } from "@/staff/growth/constants";
import { ConsoleShell } from "./shell";

export const dynamic = "force-dynamic";

export default async function Layout({ children }: { children: React.ReactNode }) {
  const s = await requireStaff();
  const [b, g] = await Promise.all([badges(s), actorFor(s)]);
  const growth = g ? GROWTH_NAV.filter(([, , p]) => can(g, p)).map(([v, l]) => [v, l] as [string, string]) : null;
  return <ConsoleShell me={{ name: s.name, role: s.role, empNo: s.empNo }} badges={b} growth={growth}>{children}</ConsoleShell>;
}
