import Link from "next/link";
import { portalAccountSummary, readPortalAccount } from "@/domain/distribution/portal";
import { inr } from "@/lib/money";

export const metadata = { title: "Dues & invoices" };

export default async function Page({ params }: { params: Promise<{ code: string }> }) {
  const a = (await readPortalAccount())!;
  const { code } = await params;
  let s;
  try { s = await portalAccountSummary(a, code); } catch (e) { return <div>{(e as Error).message}</div>; }
  const overdue = s.open.filter((b) => b.overdueDays > 0).reduce((x, b) => x + b.open, 0);
  return (
    <>
      <Link href={`/portal/${code}`} className="text-[13px]">← Order</Link>
      <h1 className="text-[22px] font-semibold mt-1">{s.distributor}: dues & invoices</h1>
      <div className="grid gap-3 grid-cols-2 sm:grid-cols-4 mb-4">
        {[["Outstanding", inr(s.balance)], ["Overdue", inr(overdue)], ["Credit limit", inr(s.limit)], ["Credit days", String(s.creditDays)]].map(([l, v]) => <div key={l} className="bg-white border border-[#E3E7ED] rounded-xl p-3"><div className="text-[11.5px] uppercase text-[#5B6B82] font-semibold">{l}</div><div className="text-[20px] font-semibold tnum">{v}</div></div>)}
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <section className="bg-white border border-[#E3E7ED] rounded-xl p-4">
          <h2 className="text-[14px] font-semibold m-0 mb-2">Invoices</h2>
          <table className="w-full text-[13px]"><thead><tr className="text-left text-[#5B6B82] text-[11.5px] uppercase"><th>Invoice</th><th>Date</th><th>Due</th><th className="text-right">Total</th><th className="text-right">Open</th></tr></thead>
            <tbody>{s.invoices.map((i) => <tr key={i.id} className="border-t border-[#EEF1F5]"><td className="py-1.5"><Link href={`/portal/${code}/invoices/${i.id}`}>{i.no}</Link></td><td>{i.date}</td><td>{i.dueDate}</td><td className="text-right tnum">{inr(i.total)}</td><td className="text-right tnum">{i.open ? inr(i.open) : "Paid"}</td></tr>)}</tbody></table>
        </section>
        <section className="bg-white border border-[#E3E7ED] rounded-xl p-4">
          <h2 className="text-[14px] font-semibold m-0 mb-2">Payments recorded</h2>
          <table className="w-full text-[13px]"><tbody>{s.payments.map((p) => <tr key={p.no} className="border-t border-[#EEF1F5]"><td className="py-1.5">{p.date}</td><td>{p.no}</td><td className="text-[#5B6B82]">{p.narration}</td><td className="text-right tnum">{inr(p.amount)}</td></tr>)}</tbody></table>
          {!s.payments.length ? <div className="text-[13px] text-[#5B6B82]">No payments recorded yet.</div> : null}
        </section>
      </div>
    </>
  );
}
