import { assignableStaff, requireGrowth } from "@/staff/growth/access";
import { calendar, listFollowUps } from "@/staff/growth/followups";
import { FollowUpsView } from "./view";

export default async function FollowUps({ searchParams }: { searchParams: Promise<{ view?: string; month?: string; staffId?: string }> }) {
  const a = await requireGrowth("calls.make");
  const sp = await searchParams;
  const view = (["today", "upcoming", "overdue", "done", "calendar"].includes(sp.view ?? "") ? sp.view : "today") as "today";
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7);
  const [list, cal, staff] = await Promise.all([
    view === ("calendar" as string) ? Promise.resolve(null) : listFollowUps(a, { view, staffId: sp.staffId }),
    view === ("calendar" as string) ? calendar(a, month, sp.staffId) : Promise.resolve(null),
    a.growthRole === "sales" ? Promise.resolve([]) : assignableStaff(a),
  ]);
  return <FollowUpsView view={view} list={list} cal={cal} month={month} staff={staff} staffId={sp.staffId ?? ""} />;
}
