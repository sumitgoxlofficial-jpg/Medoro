import { requireDistCtx, distView } from "@/domain/distribution/context";
import { listOrders as listPos, recentGrns } from "@/domain/purchasing/service";
import { listProducts } from "@/domain/distribution/masters";
import { db } from "@/server/db";
import { inr } from "@/lib/money";
import { DataTable, dateIN, PageHead, Panel, Pill, Tabs } from "../_ui/ui";
import { ActButton } from "../_ui/forms";
import { PurchaseEntry } from "../_ui/purchase-entry";
import { poStatusAction } from "../actions";

export const metadata = { title: "Purchases" };

const PO_TONE: Record<string, string> = { draft: "gray", ordered: "blue", partially_received: "amber", received: "green", cancelled: "gray", closed: "gray" };

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const ctx = await requireDistCtx();
  distView(ctx, "purchase");
  const tab = (await searchParams).tab ?? "grn";
  const [pos, grns, products, suppliers] = await Promise.all([listPos(ctx), recentGrns(ctx), listProducts(ctx, { take: 5000 }), db.supplier.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { name: "asc" }, select: { id: true, name: true } })]);
  const prods = products.filter((p) => !p.discontinued).map((p) => ({ id: p.id, name: p.name, pack: p.pack, mrp: p.mrp, pts: p.pts, gstRate: p.gstRate }));
  const openPos = pos.filter((p) => p.status === "ordered" || p.status === "partially_received");
  return (
    <>
      <PageHead title="Purchase management" sub={`Purchase planning → PO → supplier invoice → GRN → batches → stock → supplier ledger. Godown: ${ctx.branchName}.`} />
      <Tabs active={tab} tabs={[{ key: "grn", label: "Receive goods (GRN)", href: "?tab=grn" }, { key: "po", label: "Purchase orders", href: "?tab=po", count: pos.filter((p) => p.status === "draft").length }, { key: "new", label: "New PO", href: "?tab=new" }]} />
      {tab === "grn" ? (
        <>
          <Panel title="Supplier invoice → GRN" sub="Every line needs batch, expiry, quantity and rate. The lines must add up to the printed total (±₹1)." className="mb-4">
            <PurchaseEntry mode="grn" suppliers={suppliers} products={prods} pos={openPos.map((p) => ({ id: p.id, no: p.no, supplierId: p.supplierId, items: p.items }))} />
          </Panel>
          <Panel title="Recent GRNs" pad={false}>
            <DataTable cols={[{ label: "GRN" }, { label: "Supplier" }, { label: "Invoice" }, { label: "Date" }, { label: "Lines", num: true }, { label: "Total", num: true }]} rows={grns.map((g) => [g.no, g.supplier, g.invoiceNo, dateIN(g.date), g.lines, inr(g.total)])} empty="No goods received yet." />
          </Panel>
        </>
      ) : tab === "new" ? (
        <Panel title="New purchase order"><PurchaseEntry mode="po" suppliers={suppliers} products={prods} /></Panel>
      ) : (
        <Panel pad={false}>
          <DataTable cols={[{ label: "PO" }, { label: "Supplier" }, { label: "Date" }, { label: "Source" }, { label: "Items", num: true }, { label: "Value (ex-GST)", num: true }, { label: "Status" }, { label: "" }]}
            rows={pos.map((p) => [p.no, p.supplier, dateIN(p.date), p.source === "ai" ? <Pill key="a" tone="blue">Suggested</Pill> : p.source ?? "manual", p.items.length, inr(p.total), <Pill key="s" tone={PO_TONE[p.status]}>{p.status.replace("_", " ")}</Pill>,
              <span key="x" className="flex gap-1 justify-end">
                {p.status === "draft" ? <ActButton size="sm" variant="primary" label="Place" confirm="Send this PO to the supplier?" action={async () => { "use server"; return poStatusAction(p.id, "place", ""); }} /> : null}
                {p.status === "draft" || p.status === "ordered" ? <ActButton size="sm" variant="danger" label="Cancel" ask="Reason" action={async (r) => { "use server"; return poStatusAction(p.id, "cancel", r); }} /> : null}
                {p.status === "partially_received" ? <ActButton size="sm" label="Close short" ask="Why won't the rest come?" action={async (r) => { "use server"; return poStatusAction(p.id, "close", r); }} /> : null}
              </span>])} empty="No purchase orders yet." />
        </Panel>
      )}
    </>
  );
}
