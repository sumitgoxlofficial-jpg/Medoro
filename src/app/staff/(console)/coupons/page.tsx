import { requireStaff } from "@/staff/auth";
import { listCoupons } from "@/staff/coupons";
import { CouponsView } from "./view";

export const dynamic = "force-dynamic";

export default async function Page() {
  await requireStaff(["super_admin"]);
  return <CouponsView coupons={await listCoupons()} />;
}
