import Link from "next/link";
import { requireDistCtx, distView } from "@/domain/distribution/context";
import { listOrders } from "@/domain/distribution/orders";
import type { OrderStatus } from "@/domain/distribution/rules/orderflow";
import { inr } from "@/lib/money";
import { DataTable, dateIN, PageHead, Panel, Pill, STATUS_TONE, Tabs } from "../_ui/ui";

export const metadata = { title: "Orders" };

const TABS: [string, string][] = [["open", "Open"], ["pending", "Awaiting approval"], ["approved", "Approved"], ["picking", "Picking"], ["packed", "Packed"], ["invoiced", "Invoiced"], ["delivered", "Delivered"], ["all", "All"]];

export default async function Page({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const ctx = await requireDistCtx();
  distView(ctx, "order", "approve");
  const st = (await searchParams).status ?? "open";
  const rows = await listOrders(ctx, { status: st as OrderStatus });
  return (
    <>
      <PageHead title="Customer orders" sub="Portal, salesman, phone and office orders. Approval checks credit and reserves stock batch-wise." actions={<Link href="/dist/orders/new" className="h-[36px] inline-flex items-center px-3.5 rounded-lg bg-teal text-white text-[13px] font-semibold hover:text-white">+ Book order</Link>} />
      <Tabs active={st} tabs={TABS.map(([k, l]) => ({ key: k, label: l, href: `?status=${k}` }))} />
      <Panel pad={false}>
        <DataTable cols={[{ label: "Order" }, { label: "Chemist" }, { label: "Source" }, { label: "Placed" }, { label: "Lines", num: true }, { label: "Value", num: true }, { label: "Credit" }, { label: "Status" }]}
          rows={rows.map((o) => [
            <Link key="o" href={`/dist/orders/${o.id}`} className="font-medium">{o.no}</Link>, o.customer, o.source, dateIN(o.placedAt), o.lineCount, inr(o.estimate),
            o.credit && !o.credit.ok ? <Pill key="c" tone={o.overrideBy ? "blue" : "amber"}>{o.overrideBy ? "Overridden" : "Hold"}</Pill> : <Pill key="c" tone="green">OK</Pill>,
            <Pill key="s" tone={STATUS_TONE[o.status]}>{o.status}</Pill>,
          ])} empty="No orders here." />
      </Panel>
    </>
  );
}
