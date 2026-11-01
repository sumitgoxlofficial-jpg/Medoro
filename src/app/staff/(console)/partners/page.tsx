import { requireStaff } from "@/staff/auth";
import { leaderboard, partnerOverview, payoutHistory, razorpayXEnabled } from "@/staff/partners";
import { todayISO } from "@/lib/dates";
import { PartnersView } from "./view";

export const dynamic = "force-dynamic";

export default async function Page() {
  const s = await requireStaff(["super_admin"]);
  const [rows, board, history] = await Promise.all([partnerOverview(s), leaderboard(todayISO()), payoutHistory(s)]);
  const toView = (b: typeof board.today) => ({ top: b.map((r, i) => ({ rank: i + 1, name: r.name, area: r.area, sales: r.sales, signups: r.signups, earned: r.earnedPaise })) });
  const partnerIds = new Set(rows.map((r) => r.id));
  return <PartnersView rows={rows} boards={{ today: toView(board.today), week: toView(board.week), month: toView(board.month) }}
    history={history.filter((h) => partnerIds.has(h.staffId))} razorpay={razorpayXEnabled()} month={todayISO().slice(0, 7)} />;
}
