import { requireStaff } from "@/staff/auth";
import { myBank, referredPharmacies, salesList } from "@/staff/sales";
import { todayISO } from "@/lib/dates";
import { SalesView } from "./view";
import { PartnerView } from "./partner-view";

export default async function Page() {
  const s = await requireStaff(["super_admin", "sales", "partner"]);
  const month = todayISO().slice(0, 7);
  if (s.role === "partner") {
    const [rows, bank, pharmacies] = await Promise.all([salesList(s), myBank(s), referredPharmacies(s)]);
    const base = (process.env.APP_URL || "https://medoro.in").replace(/\/$/, "");
    return <PartnerView name={s.name} code={s.referralCode} link={s.referralCode ? `${base}/trial?ref=${s.referralCode}` : base} sales={rows} pharmacies={pharmacies}
      bank={bank ? `${bank.bank.split(" ")[0]} •••• ${bank.last4}` : null} month={month} />;
  }
  const [rows, bank] = await Promise.all([salesList(s), s.role === "sales" ? myBank(s) : null]);
  return <SalesView role={s.role} referral={s.referralCode} rows={rows} bank={bank ? `${bank.bank.split(" ")[0]} •••• ${bank.last4}` : null} month={month} />;
}
