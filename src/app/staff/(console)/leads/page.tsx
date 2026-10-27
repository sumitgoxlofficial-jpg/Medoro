import { db } from "@/server/db";
import { requireStaff } from "@/staff/auth";
import { getTarget, pipeline } from "@/staff/sales";
import { dateOnly, todayISO } from "@/lib/dates";
import { LeadsView } from "./view";

export default async function Page() {
  const s = await requireStaff(["super_admin", "sales"]);
  const month = dateOnly(todayISO().slice(0, 7) + "-01");
  const [leads, target, monthRev, salesCount] = await Promise.all([
    pipeline(s), getTarget(),
    db.cpSale.aggregate({ where: { date: { gte: month }, status: { not: "rejected" }, ...(s.role === "sales" ? { staffId: s.id } : {}) }, _sum: { amountPaise: true } }),
    db.staffUser.count({ where: { role: "sales", status: "active" } }),
  ]);
  const tgt = s.role === "sales" ? target : target * salesCount;
  return <LeadsView admin={s.role === "super_admin"} referral={s.referralCode} leads={leads} today={todayISO()} target={tgt} monthRevenue={monthRev._sum.amountPaise ?? 0} />;
}
