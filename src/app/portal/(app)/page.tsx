import Link from "next/link";
import { discover, readPortalAccount } from "@/domain/distribution/portal";
import { PForm } from "../_form";
import { connectAction } from "../actions";

export const metadata = { title: "My distributors" };

export default async function Page({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const a = (await readPortalAccount())!;
  const q = (await searchParams).q ?? "";
  const list = await discover(a, q);
  const mine = list.filter((d) => d.connection), others = list.filter((d) => !d.connection);
  return (
    <>
      <h1 className="text-[22px] font-semibold m-0 mb-1">Welcome, {a.ownerName}</h1>
      <p className="text-[13.5px] text-[#5B6B82] mt-0">Licence {a.dl20b} / {a.dl21b} · valid to {a.dlExpiry.toISOString().slice(0, 10)}</p>
      <h2 className="text-[13px] uppercase tracking-[0.06em] text-[#5B6B82] mt-6">My distributors</h2>
      <ul className="list-none p-0 m-0 grid gap-3 sm:grid-cols-2">
        {mine.map((d) => (
          <li key={d.tenantId} className="bg-white border border-[#E3E7ED] rounded-xl p-4">
            <div className="flex items-center gap-2"><span className="text-[16px] font-semibold flex-1">{d.name}</span><span className={`text-[12px] font-semibold px-2 py-0.5 rounded-full ${d.connection!.status === "approved" ? "bg-[#E6F4EC] text-[#1E7F4F]" : d.connection!.status === "requested" ? "bg-[#FDF2E1] text-[#94570A]" : "bg-[#FBEAE8] text-[#B3261E]"}`}>{d.connection!.status === "requested" ? "Waiting for approval" : d.connection!.status}</span></div>
            <div className="text-[13px] text-[#5B6B82]">{d.area}</div>
            {d.connection!.note ? <div className="text-[13px] text-[#B3261E] mt-1">{d.connection!.note}</div> : null}
            {d.connection!.status === "approved" ? <div className="flex gap-3 mt-3 text-[14px] font-semibold"><Link href={`/portal/${d.code}`}>Order</Link><Link href={`/portal/${d.code}/orders`}>Orders</Link><Link href={`/portal/${d.code}/account`}>Dues & invoices</Link></div> : null}
          </li>
        ))}
        {!mine.length ? <li className="text-[14px] text-[#5B6B82]">You haven’t connected to a distributor yet. Find yours below.</li> : null}
      </ul>
      <h2 className="text-[13px] uppercase tracking-[0.06em] text-[#5B6B82] mt-8">Find a distributor</h2>
      <form className="flex gap-2 mb-3"><input name="q" defaultValue={q} placeholder="Name, area or distributor code" className="h-11 flex-1 rounded-lg border border-[#C9D2DE] px-3 text-[15px]" /><button className="h-11 px-4 rounded-lg border border-[#C9D2DE] bg-white font-semibold">Search</button></form>
      <ul className="list-none p-0 m-0 grid gap-3 sm:grid-cols-2">
        {others.map((d) => (
          <li key={d.tenantId} className="bg-white border border-[#E3E7ED] rounded-xl p-4">
            <div className="text-[16px] font-semibold">{d.name}</div><div className="text-[13px] text-[#5B6B82] mb-2">{d.area}</div>
            <PForm action={connectAction} submit="Ask to connect">
              <input type="hidden" name="code" value={d.code} />
              <label className="flex gap-2 text-[12.5px] items-start"><input type="checkbox" name="share" className="mt-0.5" /><span>Share my licence, GST and contact details with {d.name} so they can verify me.</span></label>
            </PForm>
          </li>
        ))}
      </ul>
    </>
  );
}
