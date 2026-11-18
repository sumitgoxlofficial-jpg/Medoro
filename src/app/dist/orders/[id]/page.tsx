import { notFound } from "next/navigation";
import Link from "next/link";
import { requireDistCtx, distCan } from "@/domain/distribution/context";
import { orderDetail, ORDER_STATUS } from "@/domain/distribution/orders";
import { inr } from "@/lib/money";
import { DataTable, dateIN, PageHead, Panel, Pill, Note } from "../../_ui/ui";
import { ActButton } from "../../_ui/forms";
import { ApproveForm } from "../../_ui/order-actions";
import { cancelOrderAction, invoiceOrderAction, rejectOrderAction } from "../../actions";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireDistCtx();
  const { id } = await params;
  const o = await orderDetail(ctx, id);
  if (!o) notFound();
  const steps = ["pending", "approved", "picking", "packed", "invoiced", "dispatched", "delivered"];
  const at = steps.indexOf(o.status);
  return (
    <>
      <PageHead title={`Order ${o.no}`} back={{ href: "/dist/orders", label: "Orders" }} sub={`${o.customer} · ${o.source} · placed ${dateIN(o.placedAt)}${o.note ? " · “" + o.note + "”" : ""}`}
        actions={<>
          {o.status === "packed" && distCan(ctx, "bill") ? <ActButton variant="primary" label="Raise invoice" action={async () => { "use server"; return invoiceOrderAction(id); }} redirectTo="/dist/invoices/{invoiceId}" /> : null}
          {o.invoice ? <Link href={`/dist/invoices/${o.invoice.id}`} className="h-[36px] inline-flex items-center px-3 border border-[#C9D2DE] rounded-lg text-[13px] font-semibold">Invoice {o.invoice.no}</Link> : null}
          {["pending"].includes(o.status) && distCan(ctx, "approve") ? <ActButton variant="danger" label="Reject" ask="Reason the chemist will see" action={async (r) => { "use server"; return rejectOrderAction(id, r); }} /> : null}
          {["approved", "picking", "packed"].includes(o.status) && distCan(ctx, "approve") ? <ActButton variant="danger" label="Cancel order" ask="Why is it cancelled?" action={async (r) => { "use server"; return cancelOrderAction(id, r); }} /> : null}
        </>} />
      <ol className="flex flex-wrap gap-1.5 list-none p-0 m-0 mb-4">
        {o.status === "cancelled" || o.status === "rejected" ? <Pill tone="red">{ORDER_STATUS[o.status as "cancelled"]}{o.rejectReason ? ` · ${o.rejectReason}` : ""}</Pill> : steps.map((s, i) => (
          <li key={s} className={`px-2.5 h-7 inline-flex items-center rounded-full text-[12px] font-semibold ${i < at ? "bg-[#E6F4EC] text-[#1E7F4F]" : i === at ? "bg-[#0B2545] text-white" : "bg-[#EEF1F5] text-[#6B7A90]"}`}>{ORDER_STATUS[s as "pending"]}</li>
        ))}
      </ol>
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="flex flex-col gap-4">
          <Panel title="Lines" pad={false}>
            <DataTable cols={[{ label: "Product" }, { label: "Qty", num: true }, { label: "Free", num: true }, { label: "Rate", num: true }, { label: "Disc %", num: true }]}
              rows={o.lines.map((l) => [<span key="n">{l.name} <span className="text-[#5B6B82]">{l.pack}</span></span>, l.qty, l.freeQty || "", inr(l.rate), l.discPct || ""])} />
          </Panel>
          {o.pick ? (
            <Panel title={`Pick list ${o.pick.no}`} sub={`${o.pick.status}${o.pick.boxes ? ` · ${o.pick.boxes} box(es)` : ""}`} pad={false} right={distCan(ctx, "warehouse") && o.pick.status === "open" ? <Link href={`/dist/warehouse/${o.pick.id}`} className="text-[12.5px]">Open in warehouse app →</Link> : null}>
              <DataTable dense cols={[{ label: "Rack" }, { label: "Product" }, { label: "Batch" }, { label: "Expiry" }, { label: "Reserved (packs)", num: true }, { label: "Picked", num: true }]}
                rows={o.pick.lines.map((l) => [l.rack ?? "—", l.name, l.batchNo, l.expiry, l.units / l.packSize, l.pickedUnits == null ? "—" : l.pickedUnits / l.packSize])} />
            </Panel>
          ) : null}
        </div>
        <div className="flex flex-col gap-4">
          <Panel title="Value & credit">
            <div className="text-[22px] font-semibold tnum">{inr(o.estimate)}</div>
            {o.credit ? (
              <div className="text-[12.5px] text-[#4A5A73] mt-2 flex flex-col gap-1">
                <div>Balance {inr(o.credit.balance ?? 0)} · limit {inr(o.credit.limit ?? 0)}</div>
                {o.credit.ok ? <Pill tone="green">Within credit terms</Pill> : <Note tone="amber">{o.credit.reasons.join(" ")}</Note>}
                {o.overrideReason ? <div>Override: {o.overrideReason}</div> : null}
              </div>
            ) : null}
          </Panel>
          {o.status === "pending" && distCan(ctx, "approve") ? <Panel title="Approve"><ApproveForm orderId={o.id} held={!!o.credit && !o.credit.ok} canOverride={distCan(ctx, "creditOverride")} reasons={o.credit?.reasons ?? []} /></Panel> : null}
        </div>
      </div>
    </>
  );
}
