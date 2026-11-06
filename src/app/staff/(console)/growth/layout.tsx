import { requireGrowth } from "@/staff/growth/access";

export const dynamic = "force-dynamic";

export default async function GrowthLayout({ children }: { children: React.ReactNode }) {
  await requireGrowth();
  return <>{children}</>;
}
