import Link from "next/link";
import { requireDistCtx, distView } from "@/domain/distribution/context";
import { mySalesman } from "@/domain/distribution/masters";
import { receivables } from "@/domain/distribution/receivables";
import { listOrders } from "@/domain/distribution/orders";
import { inr } from "@/lib/money";
import { dateIN, Note, PageHead, Pill, STATUS_TONE } from "../_ui/ui";
import { ActForm, F, S } from "../_ui/forms";
import { collectAction } from "../actions";

export const metadata = { title: "Field app" };

export default async function Page() {
  const ctx = await requireDistCtx();
  distView(ctx, "order");
  const sm = await mySalesman(ctx);
  const rec = await receivables(ctx, sm ? { salesmanId: sm.id } : {});
  const mine = new Set(rec.map((r) => r.customerId));
  const orders = (await listOrders(ctx, { status: "all", take: 60 })).filter((o) => mine.has(o.customerId)).slice(0, 15);
  return (
    <div className="max-w-[640px]">
      <PageHead title={sm ? `Hello, ${sm.name}` : "Field app"} sub={sm ? `${rec.length} chemists on your beat` : "You are not set up as a salesman, so every chemist is shown."} />
      {!sm ? <div className="mb-3"><Note tone="blue">Owners and managers see all chemists here. Link a user to a salesman under Territories & salesmen.</Note></div> : null}
      <ul className="list-none m-0 p-0 flex flex-col gap-2.5">
        {rec.map((r) => (
          <li key={r.customerId} className="bg-white border border-[#E3E7ED] rounded-xl p-4">
            <div className="flex items-start gap-2">
              <div className="flex-1"><div className="text-[16px] font-semibold">{r.name}</div><div className="text-[13px] text-[#5B6B82]">Due {inr(r.balance)}{r.overdue ? ` · overdue ${inr(r.overdue)}` : ""}{r.phone ? ` · ${r.phone}` : ""}</div></div>
              <Pill tone={STATUS_TONE[r.status]}>{r.status}</Pill>
            </div>
            <div className="flex gap-2 mt-3">
              <Link href={`/dist/orders/new?chemist=${r.customerId}`} className="h-11 flex-1 inline-flex items-center justify-center rounded-lg bg-[#0B2545] text-white font-semibold hover:text-white">Book order</Link>
              {r.phone ? <a href={`tel:${r.phone}`} className="h-11 px-4 inline-flex items-center rounded-lg border border-[#C9D2DE] font-semibold">Call</a> : null}
            </div>
            {r.balance > 0 && ctx.perms.includes("payments") ? (
              <details className="mt-2"><summary className="cursor-pointer text-[14px] font-semibold text-[#0B2545]">Collect payment</summary>
                <ActForm action={collectAction} submit="Post receipt" resetOnOk className="mt-2">
                  <input type="hidden" name="customerId" value={r.customerId} />
                  <F label="Amount ₹" name="amount" inputMode="decimal" required />
                  <S label="Mode" name="method" options={["Cash", "UPI", "Cheque"].map((m) => ({ value: m, label: m }))} />
                  <F label="UTR / reference" name="ref" />
                  <F label="Cheque no." name="chequeNo" inputMode="numeric" /><F label="Bank" name="bank" /><F label="Cheque date" name="chequeDate" type="date" />
                </ActForm>
              </details>
            ) : null}
          </li>
        ))}
      </ul>
      <h2 className="text-[13px] uppercase tracking-[0.06em] text-[#5B6B82] mt-6 mb-2">Recent orders</h2>
      <ul className="list-none m-0 p-0 flex flex-col gap-1.5">{orders.map((o) => <li key={o.id} className="bg-white border border-[#E3E7ED] rounded-lg px-3 py-2 text-[13.5px] flex gap-2"><span className="flex-1">{o.customer} · {o.no} · {dateIN(o.placedAt)}</span><Pill tone={STATUS_TONE[o.status]}>{o.status}</Pill></li>)}</ul>
    </div>
  );
}
