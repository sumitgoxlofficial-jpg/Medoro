import Link from "next/link";
import { requireDistCtx } from "@/domain/distribution/context";
import { listReturns } from "@/domain/distribution/returns";
import { inr } from "@/lib/money";
import { DataTable, dateIN, PageHead, Panel } from "../_ui/ui";

export const metadata = { title: "Credit notes" };

export default async function Page() {
  const ctx = await requireDistCtx();
  const rows = await listReturns(ctx);
  return (
    <>
      <PageHead title="Sales returns & credit notes" sub="Raise a credit note from the invoice it belongs to. Expired and damaged returns wait in quarantine for the supplier claim." actions={<Link href="/dist/expiry" className="h-[36px] inline-flex items-center px-3 border border-[#C9D2DE] rounded-lg text-[13px] font-semibold">Expiry & claims →</Link>} />
      <Panel pad={false}>
        <DataTable cols={[{ label: "Credit note" }, { label: "Date" }, { label: "Chemist" }, { label: "Against" }, { label: "Reason" }, { label: "Packs", num: true }, { label: "To claims", num: true }, { label: "Amount", num: true }]}
          rows={rows.map((r) => [r.no, dateIN(r.at), r.customer, r.invoiceNo, r.reason, r.packs, r.toClaims || "", inr(r.total)])} empty="No credit notes yet." />
      </Panel>
    </>
  );
}
