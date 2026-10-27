import { requireStaff } from "@/staff/auth";
import { badges } from "@/staff/support";
import { ConsoleShell } from "./shell";

export const dynamic = "force-dynamic";

export default async function Layout({ children }: { children: React.ReactNode }) {
  const s = await requireStaff();
  const b = await badges(s);
  return <ConsoleShell me={{ name: s.name, role: s.role, empNo: s.empNo }} badges={b}>{children}</ConsoleShell>;
}
