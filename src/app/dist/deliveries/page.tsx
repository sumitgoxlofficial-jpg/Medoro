import { requireDistCtx, distView } from "@/domain/distribution/context";
import { myDeliveries } from "@/domain/distribution/dispatch";
import { inr } from "@/lib/money";
import { PageHead, Pill, STATUS_TONE } from "../_ui/ui";
import { ActForm, F, S } from "../_ui/forms";
import { deliverAction } from "../actions";

export const metadata = { title: "My deliveries" };

export default async function Page() {
  const ctx = await requireDistCtx();
  distView(ctx, "delivery", "dispatch");
  const trips = await myDeliveries(ctx);
  return (
    <div className="max-w-[640px]">
      <PageHead title="My deliveries" sub="Record who received the goods and any payment collected at the door." />
      {!trips.length ? <div className="bg-white border border-line rounded-xl p-8 text-center text-muted">No trips assigned to you right now.</div> : null}
      {trips.map((t) => (
        <section key={t.id} className="mb-6">
          <h2 className="text-[13px] uppercase tracking-[0.06em] text-muted mb-2">{t.no} · {t.route ?? ""} · {t.vehicleNo ?? ""}</h2>
          <div className="flex flex-col gap-3">
            {t.deliveries.map((d) => (
              <div key={d.deliveryId} className="bg-white border border-input rounded-xl p-4">
                <div className="flex items-start gap-2">
                  <div className="flex-1"><div className="text-[16px] font-semibold">{d.customer}</div><div className="text-[13px] text-muted">{d.address}</div><div className="text-[13px]">{d.no} · <strong>{inr(d.total)}</strong></div></div>
                  <Pill tone={STATUS_TONE[d.status]}>{d.status}</Pill>
                </div>
                <div className="flex gap-2 mt-2">
                  {d.phone ? <a href={`tel:${d.phone}`} className="h-10 px-3 inline-flex items-center rounded-lg border border-input text-[13px] font-semibold">Call</a> : null}
                  {d.address ? <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(d.address)}`} target="_blank" rel="noreferrer" className="h-10 px-3 inline-flex items-center rounded-lg border border-input text-[13px] font-semibold">Navigate</a> : null}
                </div>
                {d.status === "out" || d.status === "pending" ? (
                  <details className="mt-3"><summary className="cursor-pointer text-[14px] font-semibold text-teal">Record delivery</summary>
                    <ActForm action={deliverAction} submit="Save" className="mt-2">
                      <input type="hidden" name="deliveryId" value={d.deliveryId} />
                      <S label="Outcome" name="outcome" options={[{ value: "delivered", label: "Delivered" }, { value: "failed", label: "Could not deliver" }]} />
                      <F label="Received by" name="receiverName" placeholder="Name of the person who signed" />
                      <F label="Collected ₹" name="collected" inputMode="decimal" defaultValue="0" />
                      <S label="Mode" name="mode" options={[{ value: "Cash", label: "Cash" }, { value: "UPI", label: "UPI" }, { value: "Cheque", label: "Cheque" }]} />
                      <F label="UPI ref / cheque no." name="ref" />
                      <F label="Note / reason" name="note" />
                    </ActForm>
                  </details>
                ) : d.receiverName ? <div className="text-[13px] text-[#1E7F4F] mt-2">Received by {d.receiverName}{d.collected ? ` · collected ${inr(d.collected)}` : ""}</div> : null}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}
