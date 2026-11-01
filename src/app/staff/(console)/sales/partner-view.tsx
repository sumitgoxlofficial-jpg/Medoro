"use client";
import { Copy, MessageCircle } from "lucide-react";
import { CUSTOMER_STATUS, SALE_STATUS, product, rupees } from "@/staff/constants";
import { useToast } from "@/components/ui/toast";
import { Empty, Kpi, Panel, Pill, btn, fmtDay, td, th } from "../ui";

type Sale = { id: string; date: string; pharmacy: string; product: string; cycle: string; type: string; status: string; amount: number; commission: number; rate: number };
type Pharmacy = { id: string; name: string; joined: string; status: string; plan: string; renewsOn: string | null };
const SC: Record<string, [string, string]> = { pending: ["#FDF2E1", "#94570A"], verified: ["#EAF0FC", "#2459C9"], paid: ["#E7F6EE", "#18794E"], rejected: ["#FDECEC", "#C0362C"] };
const PS: Record<string, [string, string]> = { trial: ["#FDF2E1", "#94570A"], active: ["#E7F6EE", "#18794E"], grace: ["#FDECEC", "#C0362C"], cancelled: ["#F2F4F5", "#6B737B"] };

/** Reference partner dashboard: share link, referred pharmacies and earnings. */
export function PartnerView({ name, code, link, sales, pharmacies, bank, month }: { name: string; code: string | null; link: string; sales: Sale[]; pharmacies: Pharmacy[]; bank: string | null; month: string }) {
  const toast = useToast();
  const live = sales.filter((x) => x.status !== "rejected");
  const thisMonth = live.filter((x) => x.date.startsWith(month)).reduce((a, x) => a + x.commission, 0);
  const total = live.reduce((a, x) => a + x.commission, 0);
  const ready = live.filter((x) => x.status === "verified").reduce((a, x) => a + x.commission, 0);
  const paying = pharmacies.filter((p) => p.status === "active").length;
  const share = `Try Medoro, the pharmacy billing and stock app. 7-day free trial, no card needed: ${link}`;
  const copy = (text: string, what: string) => { navigator.clipboard?.writeText(text); toast(`${what} copied`, "green"); };

  return (
    <>
      <div className="grid gap-3 grid-cols-2 min-[1100px]:grid-cols-4">
        <Kpi l="Earned this month" v={rupees(thisMonth)} d={new Date(month + "-01T00:00:00").toLocaleDateString("en-IN", { month: "long", year: "numeric" })} c="#0B5E5B" />
        <Kpi l="Total earned" v={rupees(total)} d="Since you joined" />
        <Kpi l="Ready for payout" v={rupees(ready)} d={bank ? `Paid monthly to ${bank}` : "Add your bank account in Payouts"} c="#94570A" />
        <Kpi l="Pharmacies referred" v={String(pharmacies.length)} d={`${paying} paying`} />
      </div>

      <Panel title={`Your referral code, ${name.split(" ")[0]}`} sub="Pharmacies that sign up with your code or link are yours. You earn on their first payment and every renewal.">
        <div className="p-4 flex flex-col gap-3">
          <div className="flex gap-2 items-center flex-wrap">
            <span className="font-mono text-[22px] font-semibold tracking-[.06em] text-teal bg-teal-tint border border-teal-line rounded-lg px-3.5 py-1.5">{code ?? "—"}</span>
            {code ? <button className={btn} onClick={() => copy(code, "Code")}><Copy size={14} />Copy code</button> : null}
          </div>
          <div className="flex gap-2 items-center flex-wrap text-[13.5px]">
            <span className="font-mono text-[12.5px] bg-[#F7F8F9] border border-[#EEF0F2] rounded-md px-2.5 py-1.5 break-all">{link}</span>
            <button className={btn} onClick={() => copy(link, "Link")}><Copy size={14} />Copy link</button>
            <a className={btn + " no-underline"} href={`https://wa.me/?text=${encodeURIComponent(share)}`} target="_blank" rel="noreferrer"><MessageCircle size={14} className="text-[#146C43]" />Share on WhatsApp</a>
          </div>
          <div className="text-[12.5px] text-muted">The link opens sign-up with your code already filled in. Pharmacies can also type the code when they create their account.</div>
        </div>
      </Panel>

      <Panel title="Pharmacies you referred" sub="Trial means they haven’t paid yet; you earn once they do.">
        {pharmacies.length ? (
          <div className="overflow-auto tbl-scroll"><table className="w-full border-collapse min-w-[560px] text-[13.5px]">
            <thead><tr className="bg-[#FAFBFB] text-muted text-[12px]"><th className={th}>Pharmacy</th><th className={th}>Joined</th><th className={th}>Plan</th><th className={th}>Status</th></tr></thead>
            <tbody>{pharmacies.map((p) => (
              <tr key={p.id}>
                <td className={td + " font-semibold"}>{p.name}</td>
                <td className={td + " whitespace-nowrap"}>{fmtDay(p.joined)}</td>
                <td className={td}>{p.plan || "—"}{p.renewsOn ? <div className="text-[12px] text-muted">until {fmtDay(p.renewsOn)}</div> : null}</td>
                <td className={td}><Pill bg={(PS[p.status] ?? PS.trial)[0]} fg={(PS[p.status] ?? PS.trial)[1]}>{CUSTOMER_STATUS[p.status as keyof typeof CUSTOMER_STATUS] ?? p.status}</Pill></td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>No pharmacies yet. Share your link with pharmacies you visit.</Empty>}
      </Panel>

      <Panel title="Your earnings" sub="Recorded automatically when a referred pharmacy pays online. Paid out monthly after 2% TDS.">
        {sales.length ? (
          <div className="overflow-auto tbl-scroll"><table className="w-full border-collapse min-w-[720px] text-[13.5px]">
            <thead><tr className="bg-[#FAFBFB] text-muted text-[12px]"><th className={th}>Date</th><th className={th}>Pharmacy</th><th className={th}>Plan</th><th className={th + " text-right"}>Paid (before GST)</th><th className={th + " text-right"}>Your earning</th><th className={th}>Status</th></tr></thead>
            <tbody>{sales.map((x) => {
              const p = product(x.product);
              return (
                <tr key={x.id}>
                  <td className={td + " whitespace-nowrap"}>{fmtDay(x.date)}</td>
                  <td className={td + " font-semibold"}>{x.pharmacy}</td>
                  <td className={td}>{p.name}{x.cycle === "y" ? " · yearly" : " · monthly"} · {x.type === "new" ? "First payment" : "Renewal"}</td>
                  <td className={td + " text-right tnum"}>{rupees(x.amount)}</td>
                  <td className={td + " text-right tnum font-semibold text-teal"}>{rupees(x.commission)}<div className="text-[11px] text-muted font-normal">{x.rate}%</div></td>
                  <td className={td}><Pill bg={SC[x.status][0]} fg={SC[x.status][1]}>{x.status === "verified" ? "Ready for payout" : SALE_STATUS[x.status as keyof typeof SALE_STATUS]}</Pill></td>
                </tr>
              );
            })}</tbody>
          </table></div>
        ) : <Empty>No earnings yet. You earn as soon as a pharmacy you referred pays for a plan.</Empty>}
      </Panel>
    </>
  );
}
