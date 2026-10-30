"use client";
import { useEffect, useState, useTransition } from "react";
import { Calculator } from "lucide-react";
import { PRODUCTS, SALE_STATUS, product, rupees, type StaffRoleId } from "@/staff/constants";
import { logSale, previewCommission, verifySale } from "../../actions";
import { Empty, Kpi, Panel, Pill, btn, btnPrimary, fieldCls, fmtDay, lbl, panel, td, th, useRun } from "../ui";

type Row = { id: string; date: string; payRef: string | null; pharmacy: string; product: string; cycle: string; type: string; staff: string; status: string; amount: number; commission: number; rate: number };
const SC: Record<string, [string, string]> = { pending: ["#FDF2E1", "#94570A"], verified: ["#EAF0FC", "#2459C9"], paid: ["#E7F6EE", "#18794E"], rejected: ["#FDECEC", "#C0362C"] };

export function SalesView({ role, referral, rows, bank, month }: { role: StaffRoleId; referral: string | null; rows: Row[]; bank: string | null; month: string }) {
  const { run, busy } = useRun();
  const [f, setF] = useState({ pharmacy: "", phone: "", city: "", product: "pro", cycle: "m" });
  const [pv, setPv] = useState<{ amount: number; rate: number; commission: number } | null>(null);
  const [, start] = useTransition();
  const sales = role === "sales";
  useEffect(() => { if (sales) start(async () => { const r = await previewCommission(f.product, f.cycle); if (r.ok) setPv(r.data); }); }, [sales, f.product, f.cycle]);
  const sum = (st: string[]) => rows.filter((x) => st.includes(x.status)).reduce((a, x) => a + x.commission, 0);
  const set = (k: string, v: string) => setF((x) => ({ ...x, [k]: v }));

  return (
    <>
      {sales ? (
        <>
          <div className="grid gap-3 grid-cols-2 min-[1100px]:grid-cols-4">
            <Kpi l="Earned this month" v={rupees(rows.filter((x) => x.date.startsWith(month) && x.status !== "rejected").reduce((a, x) => a + x.commission, 0))} d="Including pending" c="#0B5E5B" />
            <Kpi l="Awaiting verification" v={rupees(sum(["pending"]))} d="Confirmed when payment clears" c="#94570A" />
            <Kpi l="Ready for payout" v={rupees(sum(["verified"]))} d={bank ? `Paid to ${bank}` : "Add a bank account in Payouts"} />
            <Kpi l="Referral code" v={referral ?? "—"} d="Give it to pharmacies you sign up" />
          </div>
          <form onSubmit={(e) => { e.preventDefault(); run(() => logSale(f as never), () => setF({ pharmacy: "", phone: "", city: "", product: "pro", cycle: "m" })); }} className={panel + " border-teal-line p-[18px] flex flex-col gap-3"}>
            <strong className="text-[15px]">Log a sale</strong>
            <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">
              <label className={lbl}>Pharmacy name<input className={fieldCls} value={f.pharmacy} onChange={(e) => set("pharmacy", e.target.value)} /></label>
              <label className={lbl}>Owner mobile<input className={fieldCls} value={f.phone} onChange={(e) => set("phone", e.target.value)} inputMode="tel" /></label>
              <label className={lbl}>City<input className={fieldCls} value={f.city} onChange={(e) => set("city", e.target.value)} /></label>
              <label className={lbl}>Product<select className={fieldCls} value={f.product} onChange={(e) => set("product", e.target.value)}>{PRODUCTS.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
              <label className={lbl}>Billing<select className={fieldCls} value={f.cycle} onChange={(e) => set("cycle", e.target.value)}><option value="m">Monthly</option><option value="y">Yearly</option></select></label>
            </div>
            <div className="flex gap-2.5 items-center flex-wrap bg-[#F2F9F8] rounded-lg px-3 py-2.5 text-[13.5px]">
              <Calculator size={16} className="text-teal" /><span>{pv ? `Amount before GST ${rupees(pv.amount)} · your rate ${pv.rate}% · commission ${rupees(pv.commission)}` : "Working out your commission…"}</span>
              <button disabled={busy} className={btnPrimary + " ml-auto"}>Submit for verification</button>
            </div>
          </form>
        </>
      ) : null}
      <Panel title={sales ? "My sales" : "All sales"} sub="Commission is confirmed once the customer’s payment is verified.">
        {rows.length ? (
          <div className="overflow-auto"><table className="w-full border-collapse min-w-[860px] text-[13.5px]">
            <thead><tr className="bg-[#FAFBFB] text-muted text-[12px]"><th className={th}>Date</th><th className={th}>Pharmacy</th><th className={th}>Product</th>{!sales ? <th className={th}>Salesperson</th> : null}<th className={th + " text-right"}>Amount ex-GST</th><th className={th + " text-right"}>Commission</th><th className={th}>Status</th>{!sales ? <th className={th} /> : null}</tr></thead>
            <tbody>{rows.map((x) => {
              const p = product(x.product);
              return (
                <tr key={x.id}>
                  <td className={td + " whitespace-nowrap"}>{fmtDay(x.date)}</td>
                  <td className={td + " font-semibold"}>{x.pharmacy}{x.payRef ? <div className="text-[12px] text-muted font-normal">Paid via app · ref {x.payRef}</div> : null}</td>
                  <td className={td}>{p.name}{"once" in p ? "" : x.cycle === "y" ? " · yearly" : " · monthly"} · {x.type === "new" ? "New" : "Renewal"}</td>
                  {!sales ? <td className={td}>{x.staff}</td> : null}
                  <td className={td + " text-right tnum"}>{rupees(x.amount)}</td>
                  <td className={td + " text-right tnum font-semibold text-teal"}>{rupees(x.commission)}<div className="text-[11px] text-muted font-normal">{x.rate}%</div></td>
                  <td className={td}><Pill bg={SC[x.status][0]} fg={SC[x.status][1]}>{SALE_STATUS[x.status as keyof typeof SALE_STATUS]}</Pill></td>
                  {!sales ? <td className={td + " text-right"}>{x.status === "pending" ? <div className="flex gap-1.5 justify-end"><button disabled={busy} className={btn} onClick={() => run(() => verifySale(x.id, "verify"))}>Verify payment</button><button disabled={busy} className={btn + " text-[#C0362C]"} onClick={() => { if (confirm(`Reject the sale to ${x.pharmacy}? No commission is paid.`)) run(() => verifySale(x.id, "reject")); }}>Reject</button></div> : null}</td> : null}
                </tr>
              );
            })}</tbody>
          </table></div>
        ) : <Empty>{sales ? "No sales yet. Log one above, or mark a lead won in the pipeline." : "No sales logged yet."}</Empty>}
      </Panel>
    </>
  );
}
