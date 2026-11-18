import Link from "next/link";
import { requireDistCtx, distView } from "@/domain/distribution/context";
import { listInvoices } from "@/domain/distribution/billing";
import { inr } from "@/lib/money";
import { DataTable, dateIN, PageHead, Panel, Pill, STATUS_TONE } from "../_ui/ui";

export const metadata = { title: "Invoices" };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string; from?: string; to?: string }> }) {
  const ctx = await requireDistCtx();
  distView(ctx, "bill", "reports", "payments");
  const sp = await searchParams;
  const rows = await listInvoices(ctx, { q: sp.q, from: sp.from, to: sp.to });
  const live = rows.filter((r) => !r.cancelled);
  return (
    <>
      <PageHead title="Wholesale invoices" sub="GST tax invoices. Invoices are never edited: cancel the same day or raise a credit note." actions={ctx.perms.includes("bill") ? <Link href="/dist/billing" className="h-[36px] inline-flex items-center px-3.5 rounded-lg bg-[#0B2545] text-white text-[13px] font-semibold hover:text-white">+ New invoice</Link> : null} />
      <Panel pad={false} title={`${rows.length} invoices`} right={<form className="flex gap-1.5 flex-wrap"><input data-search name="q" defaultValue={sp.q} placeholder="Invoice no." className="h-8 w-[130px] rounded-md border border-[#C9D2DE] px-2 text-[13px]" /><input type="date" name="from" defaultValue={sp.from} className="h-8 rounded-md border border-[#C9D2DE] px-1 text-[12px]" /><input type="date" name="to" defaultValue={sp.to} className="h-8 rounded-md border border-[#C9D2DE] px-1 text-[12px]" /><button className="h-8 px-2 border border-[#C9D2DE] rounded-md text-[12.5px]">Filter</button></form>}>
        <DataTable cols={[{ label: "Invoice" }, { label: "Date" }, { label: "Chemist" }, { label: "Taxable", num: true }, { label: "GST", num: true }, { label: "Total", num: true }, { label: "Due" }, { label: "Delivery" }]}
          rows={rows.map((i) => [<Link key="n" href={`/dist/invoices/${i.id}`} className="font-medium">{i.no}</Link>, dateIN(i.date), i.customer, inr(i.taxable), inr(i.tax), i.cancelled ? <s key="c">{inr(i.total)}</s> : inr(i.total), dateIN(i.dueDate),
            i.cancelled ? <Pill key="p" tone="gray">Cancelled</Pill> : i.delivery ? <Pill key="p" tone={STATUS_TONE[i.delivery]}>{i.delivery}</Pill> : "—"])}
          footer={["Total", "", `${live.length} live`, inr(live.reduce((a, i) => a + i.taxable, 0)), inr(live.reduce((a, i) => a + i.tax, 0)), inr(live.reduce((a, i) => a + i.total, 0)), "", ""]} empty="No invoices yet." />
      </Panel>
    </>
  );
}
