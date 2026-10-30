import { requireCtx, can } from "@/server/context";
import { db } from "@/server/db";
import { listRecalls } from "@/domain/inventory/recalls";
import { PageHead } from "@/components/page-head";
import { t } from "@/lib/i18n";
import { todayISO } from "@/lib/dates";
import { RecallsView } from "./view";

export const metadata = { title: "Recalls & alerts" };

export default async function Page() {
  const ctx = await requireCtx();
  const meds = await db.medicine.findMany({ where: { tenantId: ctx.tenantId, active: true }, orderBy: { name: "asc" }, select: { id: true, name: true, strength: true } });
  return (
    <>
      <PageHead title={t(ctx.lang).recall} sub="Verified recall notices matched to your batches in every branch" />
      <RecallsView recalls={await listRecalls(ctx)} canAdjust={can(ctx, "adjust")} canPurchase={can(ctx, "purchase")} branchName={ctx.branchName} canRecord={can(ctx, "adjust") || can(ctx, "users")} today={todayISO()} medicines={meds.map((m) => ({ id: m.id, label: `${m.name} ${m.strength}`.trim() }))} />
    </>
  );
}
