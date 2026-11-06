import { requireGrowth } from "@/staff/growth/access";
import { verificationQueue } from "@/staff/growth/verify";
import { VerificationView } from "./view";

export default async function Verification() {
  const a = await requireGrowth("leads.verify");
  const q = await verificationQueue(a);
  return <VerificationView q={JSON.parse(JSON.stringify(q))} />;
}
