import { requireStaff } from "@/staff/auth";
import { myBank, salesList } from "@/staff/sales";
import { todayISO } from "@/lib/dates";
import { SalesView } from "./view";

export default async function Page() {
  const s = await requireStaff(["super_admin", "sales"]);
  const [rows, bank] = await Promise.all([salesList(s), s.role === "sales" ? myBank(s) : null]);
  return <SalesView role={s.role} referral={s.referralCode} rows={rows} bank={bank ? `${bank.bank.split(" ")[0]} •••• ${bank.last4}` : null} month={todayISO().slice(0, 7)} />;
}
