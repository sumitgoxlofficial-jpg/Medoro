import { db } from "@/server/db";
import { requireStaff } from "@/staff/auth";
import { myBank, payouts, pendingBanks } from "@/staff/sales";
import { PayoutsView } from "./view";

export default async function Page() {
  const s = await requireStaff(["super_admin", "sales", "partner"]);
  const admin = s.role === "super_admin";
  const [rows, bank, banks, verified] = await Promise.all([
    payouts(s), admin ? null : myBank(s), admin ? pendingBanks() : [],
    admin ? db.cpSale.findMany({ where: { status: "verified" }, select: { commissionPaise: true, staffId: true } }) : [],
  ]);
  const run = { total: verified.reduce((a, x) => a + x.commissionPaise, 0), people: new Set(verified.map((x) => x.staffId)).size };
  return <PayoutsView admin={admin} name={s.name} rows={rows} bank={bank} pendingBanks={banks} run={run} />;
}
