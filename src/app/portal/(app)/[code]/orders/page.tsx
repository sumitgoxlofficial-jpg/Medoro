import Link from "next/link";
import { portalOrders, readPortalAccount } from "@/domain/distribution/portal";
import { ORDER_STATUS } from "@/domain/distribution/rules/orderflow";
import { inr } from "@/lib/money";
import { PCancel } from "../../../_cancel";

export const metadata = { title: "My orders" };

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const a = (await readPortalAccount())!;
  const { code } = await params;
  let orders;
  try { orders = await portalOrders(a, code); } catch (e) { return <div>{(e as Error).message}</div>; }
  const steps = ["pending", "approved", "picking", "packed", "invoiced", "dispatched", "delivered"];
  return (
    <>
      <Link href={`/portal/${code}`} className="text-[13px]">← Order more</Link>
      <h1 className="text-[22px] font-semibold mt-1">Order tracking</h1>
      <ul className="list-none p-0 m-0 flex flex-col gap-3">
        {orders.map((o) => {
          const at = steps.indexOf(o.status);
          return (
            <li key={o.id} className="bg-white border border-line rounded-xl p-4">
              <div className="flex flex-wrap items-center gap-2"><span className="font-semibold">{o.no}</span><span className="text-[13px] text-muted">{o.placedAt.toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}</span><span className="ml-auto font-semibold tnum">{inr(o.invoice?.total ?? o.estimate)}</span></div>
              {at >= 0 ? <div className="flex gap-1 mt-2">{steps.map((s, i) => <span key={s} title={ORDER_STATUS[s as "pending"]} className={`h-1.5 flex-1 rounded ${i <= at ? "bg-[#1E7F4F]" : "bg-line"}`} />)}</div> : null}
              <div className="text-[13px] mt-1.5"><strong>{ORDER_STATUS[o.status as "pending"] ?? o.status}</strong>{o.rejectReason ? ` · ${o.rejectReason}` : ""}</div>
              <div className="text-[12.5px] text-muted mt-1">{o.lines.map((l) => `${l.name} × ${l.qty}${l.freeQty ? ` +${l.freeQty}` : ""}`).join(", ")}</div>
              <div className="flex gap-3 mt-2 text-[13.5px] font-semibold">
                {o.invoice ? <Link href={`/portal/${code}/invoices/${o.invoice.id}`}>Invoice {o.invoice.no}</Link> : null}
                <Link href={`/portal/${code}?repeat=${o.id}`}>Repeat order</Link>
                {o.status === "pending" ? <PCancel code={code} orderId={o.id} /> : null}
              </div>
            </li>
          );
        })}
        {!orders.length ? <li className="text-muted">No orders yet.</li> : null}
      </ul>
    </>
  );
}
