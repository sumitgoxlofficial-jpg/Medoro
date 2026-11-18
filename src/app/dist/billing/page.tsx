import { requireDistCtx, distView } from "@/domain/distribution/context";
import { PageHead } from "../_ui/ui";
import { LineEntry } from "../_ui/entry";
import { entryChemists, ownState } from "../_lib/data";

export const metadata = { title: "New invoice" };

export default async function Page({ searchParams }: { searchParams: Promise<{ chemist?: string }> }) {
  const ctx = await requireDistCtx();
  distView(ctx, "bill");
  const sp = await searchParams;
  const [chemists, state] = await Promise.all([entryChemists(ctx), ownState(ctx)]);
  return (
    <>
      <PageHead title="Wholesale GST invoice" sub={`Counter / direct billing from ${ctx.branchName}. For orders, invoice from the packed order instead.`} />
      <LineEntry chemists={chemists} mode="bill" ownState={state} canOverride={ctx.perms.includes("creditOverride")} initialChemist={sp.chemist} />
    </>
  );
}
