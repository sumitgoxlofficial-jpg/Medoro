import { redirect } from "next/navigation";
import { requireCtx, can } from "@/server/context";
import { listEstimates } from "@/domain/sales/estimate";
import { PageHead } from "@/components/page-head";
import { t } from "@/lib/i18n";
import { EstimatesView } from "./view";

export const metadata = { title: "Estimates" };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const ctx = await requireCtx();
  if (!can(ctx, "sale")) redirect("/app");
  const { q } = await searchParams;
  return (
    <>
      <PageHead title={t(ctx.lang).est} sub="A priced list for a customer who isn’t buying yet. Nothing is reserved or billed." />
      <EstimatesView rows={await listEstimates(ctx, { q })} q={q ?? ""} />
    </>
  );
}
