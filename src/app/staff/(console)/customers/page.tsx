import { requireStaff } from "@/staff/auth";
import { customerDetail, customers } from "@/staff/support";
import { CustomersView } from "./view";
import { ROLES_FOR } from "../nav";

export default async function Page({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const s = await requireStaff(ROLES_FOR.customers);
  const { c } = await searchParams;
  const [rows, detail] = await Promise.all([customers(s), c ? customerDetail(s, c) : null]);
  return <CustomersView role={s.role} rows={rows} detail={detail} />;
}
