import { requireCtx, can } from "@/server/context";
import { listRecalls } from "@/domain/inventory/recalls";
import { PageHead } from "@/components/page-head";
import { t } from "@/lib/i18n";
import { todayISO } from "@/lib/dates";
import { RecallsView } from "./view";

export const metadata = { title: "Recalls & alerts" };

export default async function Page() {
  const ctx = await requireCtx();
  return (
    <>
      <PageHead title={t(ctx.lang).recall} sub="Verified recall notices matched to your batches in every branch" />
      <RecallsView recalls={await listRecalls(ctx)} canAdjust={can(ctx, "adjust")} canRecord={can(ctx, "adjust") || can(ctx, "users")} today={todayISO()} />
    </>
  );
}
