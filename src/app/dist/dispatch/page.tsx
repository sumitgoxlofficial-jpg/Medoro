import Link from "next/link";
import { requireDistCtx, distView } from "@/domain/distribution/context";
import { dispatchBoard } from "@/domain/distribution/dispatch";
import { inr } from "@/lib/money";
import { DataTable, dateIN, PageHead, Panel, Pill, STATUS_TONE } from "../_ui/ui";
import { ActButton, ActForm, F, Grid, S } from "../_ui/forms";
import { createDispatchAction, startDispatchAction } from "../actions";

export const metadata = { title: "Dispatch" };

export default async function Page() {
  const ctx = await requireDistCtx();
  distView(ctx, "dispatch");
  const b = await dispatchBoard(ctx);
  return (
    <>
      <PageHead title="Dispatch planning" sub="Group invoiced orders into van / route trips, assign the delivery person, and track proof of delivery." actions={<Link href="/dist/deliveries" className="h-[36px] inline-flex items-center px-3 border border-[#C9D2DE] rounded-lg text-[13px] font-semibold">Delivery app →</Link>} />
      <Panel title={`Ready to dispatch · ${b.pending.length}`} className="mb-4">
        {b.pending.length ? (
          <ActForm action={createDispatchAction} submit="Plan trip" resetOnOk>
            <div className="max-h-[320px] overflow-y-auto border border-[#EEF1F5] rounded-md">
              {b.pending.map((d) => (
                <label key={d.invoiceId} className="flex items-center gap-3 px-3 py-2 border-b border-[#EEF1F5] last:border-0 text-[13px] cursor-pointer hover:bg-[#FAFBFC]">
                  <input type="checkbox" name="invoiceIds" value={d.invoiceId} className="size-4" />
                  <span className="w-[130px] font-medium">{d.no}</span><span className="flex-1">{d.customer} <span className="text-[#5B6B82]">{d.address}</span></span><span className="tnum">{inr(d.total)}</span>
                  {d.failReason ? <Pill tone="red">Retry: {d.failReason}</Pill> : null}
                </label>
              ))}
            </div>
            <Grid cols={4}>
              <F label="Vehicle no." name="vehicleNo" placeholder="MH12AB1234" />
              <F label="Driver" name="driverName" />
              <S label="Delivery person (app)" name="deliveryUser" options={[{ value: "", label: "—" }, ...b.deliveryStaff.map((u) => ({ value: u.id, label: u.name }))]} />
              <F label="Route" name="route" placeholder="Kothrud – Karve Nagar" />
            </Grid>
          </ActForm>
        ) : <div className="text-[13px] text-[#5B6B82]">Nothing waiting. Invoices appear here as soon as they are raised.</div>}
      </Panel>
      <div className="flex flex-col gap-4">
        {b.trips.map((t) => (
          <Panel key={t.id} title={`${t.no} · ${t.route ?? "No route"}`} sub={`${t.vehicleNo ?? "—"} · ${t.driverName ?? "—"}${t.deliveryName ? " · app: " + t.deliveryName : ""} · ${dateIN(t.createdAt)}`} pad={false}
            right={<span className="flex gap-2 items-center"><Pill tone={STATUS_TONE[t.status]}>{t.status}</Pill>{t.status === "planned" ? <ActButton size="sm" variant="primary" label="Van left" action={async () => { "use server"; return startDispatchAction(t.id); }} /> : null}</span>}>
            <DataTable dense cols={[{ label: "Invoice" }, { label: "Chemist" }, { label: "Value", num: true }, { label: "Status" }, { label: "Received by" }, { label: "Collected", num: true }]}
              rows={t.deliveries.map((d) => [<Link key="i" href={`/dist/invoices/${d.invoiceId}`}>{d.no}</Link>, d.customer, inr(d.total), <Pill key="s" tone={STATUS_TONE[d.status]}>{d.status}</Pill>, d.receiverName ?? "", d.collected ? inr(d.collected) : ""])} />
          </Panel>
        ))}
      </div>
    </>
  );
}
