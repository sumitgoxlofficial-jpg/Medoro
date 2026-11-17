import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { requireCtx, can } from "@/server/context";
import { recallReport } from "@/domain/inventory/recall-report";
import { UserError } from "@/server/action";
import { PageHead } from "@/components/page-head";
import { DisposeForm, ResolveForm } from "../report-forms";

export const metadata = { title: "Recall report" };
const card = "bg-white border border-line rounded-xl p-4";
const th = "py-1.5 pr-3 text-left font-normal text-slate-500";
const when = (iso: string | null) => (iso ? iso.slice(0, 16).replace("T", " ") + " UTC" : "–");

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireCtx();
  if (!(can(ctx, "adjust") || can(ctx, "users") || can(ctx, "reports"))) redirect("/app");
  let d;
  try { d = await recallReport(ctx, (await params).id); } catch (e) { if (e instanceof UserError) notFound(); throw e; }
  const n = d.notice, canAct = can(ctx, "adjust") && !ctx.readOnly;
  return (
    <>
      <PageHead title={`Recall ${n.ref}: ${n.product}`} sub={`${n.status} · ${n.source} · published ${n.publishedAt}`} right={<Link href="/app/recalls/report" className="text-[13px] underline">All recall reports</Link>} />
      <div className="max-w-[1400px] flex flex-col gap-4">
        <section className={card} data-testid="recall-notice">
          <h2 className="m-0 mb-2 text-[15px] font-semibold">Notice</h2>
          <dl className="m-0 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-[13px]">
            <div><dt className="inline text-slate-500">Batches: </dt><dd className="inline">{n.batchNos.join(", ")}</dd></div>
            <div><dt className="inline text-slate-500">Manufacturer: </dt><dd className="inline">{n.manufacturer ?? "matched by catalogue medicine"}</dd></div>
            <div><dt className="inline text-slate-500">Reason: </dt><dd className="inline">{n.reason}</dd></div>
            <div><dt className="inline text-slate-500">Authority’s notice no.: </dt><dd className="inline">{n.noticeNo ?? "–"}</dd></div>
            <div><dt className="inline text-slate-500">Link: </dt><dd className="inline">{n.sourceUrl ? <a href={n.sourceUrl} rel="noopener noreferrer nofollow" target="_blank" className="underline break-all">{n.sourceUrl}</a> : "–"}</dd></div>
            <div><dt className="inline text-slate-500">Recorded: </dt><dd className="inline">{when(n.recordedAt)} · checked at its source and recorded by {n.attestedBy ?? "unknown"}</dd></div>
            {n.resolvedAt ? <div className="sm:col-span-2"><dt className="inline text-slate-500">Resolved: </dt><dd className="inline">{when(n.resolvedAt)}{n.resolutionNote ? ` · ${n.resolutionNote}` : ""}</dd></div> : null}
          </dl>
          <p className="m-0 mt-2 text-[12px] text-slate-500">“Recorded by” means the person entering it says they checked it at the authority’s own notice. Medoro does not fetch notices from any government feed.</p>
        </section>

        <section className={card} data-testid="recall-trace">
          <h2 className="m-0 mb-1 text-[15px] font-semibold">Affected quantity (stock units, branches you can access)</h2>
          <p className="m-0 mb-2 text-[13px]">Traced {d.totals.traced}: on hand {d.totals.onHand} (sellable now {d.totals.sellableNow}), sold {d.totals.sold}, returned to supplier {d.totals.returnedToSupplier}, destroyed or handed back {d.totals.disposed}.</p>
          {d.batches.length ? <div className="overflow-x-auto"><table className="w-full text-[13px] border-collapse"><thead><tr><th className={th}>Branch</th><th className={th}>Medicine</th><th className={th}>Batch</th><th className={th}>Status</th><th className={th}>On hand</th><th className={th}>Sold</th><th className={th}>To supplier</th><th className={th}>Disposed</th><th className={th}>Traced</th><th className={th}></th></tr></thead>
            <tbody>{d.batches.map((b) => (
              <tr key={b.batchId} className="border-t border-line/60 align-top"><td className="py-1.5 pr-3">{b.branch}</td><td className="pr-3">{b.medicine}</td><td className="pr-3">{b.batchNo}</td><td className="pr-3">{b.sellableNow ? <strong className="text-red-700">Sellable</strong> : b.status}</td><td className="pr-3">{b.onHand}</td><td className="pr-3">{b.sold}</td><td className="pr-3">{b.returnedToSupplier}</td><td className="pr-3">{b.disposed}</td><td className="pr-3">{b.traced}</td>
                <td>{canAct && b.onHand > 0 && b.branchId === ctx.branchId ? <DisposeForm recallId={n.id} batchId={b.batchId} max={b.onHand} /> : b.onHand > 0 && b.branchId !== ctx.branchId ? <span className="text-slate-500">Switch to {b.branch} to dispose</span> : null}</td></tr>))}</tbody></table></div>
            : <p className="m-0 text-[13px] text-slate-500">No batch of yours matches this notice in the branches you can see.</p>}
        </section>

        <section className={card} data-testid="recall-customers">
          <h2 className="m-0 mb-1 text-[15px] font-semibold">Customers who bought an affected batch</h2>
          <p className="m-0 mb-2 text-[12px] text-slate-500">For you to contact about a safety recall. “Can message” means they agreed to invoice and reminder messages; it is not marketing consent, and nothing is sent from this screen.</p>
          {d.customers.length ? <ul className="m-0 p-0 list-none grid gap-1 text-[13px]">{d.customers.map((c, i) => <li key={i}><strong>{c.customer}</strong> {c.phone ? `· ${c.phone}` : ""} · bill {c.invoiceNo} on {c.at.slice(0, 10)} · {c.qty} {c.unit} · {c.canMessage ? "can message" : "call or visit only"}</li>)}</ul> : <p className="m-0 text-[13px] text-slate-500">No named customer bought an affected batch (walk-in bills carry no customer).</p>}
        </section>

        <section className={card} data-testid="recall-resolution">
          <h2 className="m-0 mb-2 text-[15px] font-semibold">Disposal and resolution</h2>
          {d.disposals.length ? <ul className="m-0 mb-2 pl-4 text-[13px]">{d.disposals.map((x, i) => <li key={i}>{x.at.slice(0, 10)} · {x.branch} · batch {x.batchNo} × {x.qty} · {x.method === "destroyed" ? "destroyed" : "returned to manufacturer"} · {x.reference} · {x.by}</li>)}</ul> : <p className="m-0 mb-2 text-[13px] text-slate-500">No disposal recorded.</p>}
          <p className="m-0 mb-2 text-[13px]">{d.closable.reason}</p>
          {canAct || can(ctx, "users") ? <ResolveForm id={n.id} resolved={n.status === "resolved"} closable={d.closable.ok} /> : null}
        </section>

        <section className={card} data-testid="recall-audit">
          <h2 className="m-0 mb-2 text-[15px] font-semibold">Audit trail</h2>
          <ul className="m-0 pl-4 text-[13px] grid gap-0.5">{d.audit.map((a, i) => <li key={i}>{when(a.at)} · {a.who} · {a.action}{a.detail ? ` · ${a.detail}` : ""}</li>)}</ul>
        </section>
      </div>
    </>
  );
}
