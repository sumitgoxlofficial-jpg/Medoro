import { db } from "@/server/db";
import { requireStaff } from "@/staff/auth";
import { ticketDetail, tickets } from "@/staff/support";
import { TicketsView } from "./view";

export default async function Page({ searchParams }: { searchParams: Promise<{ t?: string; f?: string }> }) {
  await requireStaff(["super_admin", "care"]);
  const { t, f } = await searchParams;
  const [rows, detail, team] = await Promise.all([tickets(), t ? ticketDetail(t) : null, db.staffUser.findMany({ where: { role: { in: ["care", "super_admin"] }, status: "active" }, select: { id: true, name: true }, orderBy: { name: "asc" } })]);
  return <TicketsView rows={rows} detail={detail} team={team} filter={(["open", "waiting", "resolved", "all"].includes(f ?? "") ? f : t ? "all" : "open") as "open"} now={Date.now()} />;
}
