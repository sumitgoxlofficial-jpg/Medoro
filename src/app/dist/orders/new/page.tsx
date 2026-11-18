import { requireDistCtx, distView } from "@/domain/distribution/context";
import { PageHead } from "../../_ui/ui";
import { LineEntry } from "../../_ui/entry";
import { entryChemists, ownState } from "../../_lib/data";

export const metadata = { title: "New order" };

export default async function Page({ searchParams }: { searchParams: Promise<{ chemist?: string }> }) {
  const ctx = await requireDistCtx();
  distView(ctx, "order");
  const sp = await searchParams;
  const [chemists, state] = await Promise.all([entryChemists(ctx, { salesmanOnly: !ctx.perms.includes("approve") }), ownState(ctx)]);
  return (
    <>
      <PageHead title="Book an order" back={{ href: "/dist/orders", label: "Orders" }} sub={`From ${ctx.branchName}. Phone, WhatsApp and office orders; salesmen use the field app.`} />
      <LineEntry chemists={chemists} mode="order" ownState={state} initialChemist={sp.chemist} />
    </>
  );
}
