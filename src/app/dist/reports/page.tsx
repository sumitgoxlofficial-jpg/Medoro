import Link from "next/link";
import { requireDistCtx, distView } from "@/domain/distribution/context";
import { DIST_REPORTS, distReport, isDistReport } from "@/domain/distribution/reports";
import { inr } from "@/lib/money";
import { DataTable, PageHead, Panel } from "../_ui/ui";

export const metadata = { title: "MIS reports" };

export default async function Page({ searchParams }: { searchParams: Promise<{ id?: string; from?: string; to?: string }> }) {
  const ctx = await requireDistCtx();
  distView(ctx, "reports");
  const sp = await searchParams;
  const id = sp.id && isDistReport(sp.id) ? sp.id : "sales-product";
  const r = await distReport(ctx, id, sp.from, sp.to);
  const qs = new URLSearchParams({ id, ...(sp.from ? { from: sp.from } : {}), ...(sp.to ? { to: sp.to } : {}) }).toString();
  return (
    <>
      <PageHead title="Business MIS reports" sub="Every figure comes from posted invoices, GRNs, vouchers and stock. Download any report as CSV for Excel or your CA." />
      <div className="grid gap-4 lg:grid-cols-[230px_1fr]">
        <nav className="bg-white border border-[#E3E7ED] rounded-[10px] p-2 h-fit flex lg:flex-col gap-0.5 overflow-x-auto">
          {DIST_REPORTS.map(([k, l]) => <Link key={k} href={`?id=${k}${sp.from ? `&from=${sp.from}` : ""}${sp.to ? `&to=${sp.to}` : ""}`} className={`px-2.5 py-1.5 rounded-md text-[13px] whitespace-nowrap ${k === id ? "bg-[#0B2545] text-white hover:text-white" : "text-[#1B2B44] hover:bg-[#F3F6F9]"}`}>{l}</Link>)}
        </nav>
        <Panel title={r.title} sub={r.note} pad={false} right={
          <div className="flex gap-1.5 flex-wrap items-center">
            <form className="flex gap-1"><input type="hidden" name="id" value={id} /><input type="date" name="from" defaultValue={sp.from} className="h-8 border border-[#C9D2DE] rounded px-1 text-[12px]" /><input type="date" name="to" defaultValue={sp.to} className="h-8 border border-[#C9D2DE] rounded px-1 text-[12px]" /><button className="h-8 px-2 border border-[#C9D2DE] rounded text-[12px]">Apply</button></form>
            <a href={`/api/dist/report?${qs}`} className="h-8 px-2.5 inline-flex items-center rounded bg-[#0B2545] text-white text-[12.5px] font-semibold hover:text-white">CSV</a>
          </div>}>
          <DataTable dense cols={r.columns.map((c, i) => ({ label: c, num: r.money.includes(i) || r.rows.some((row) => typeof row[i] === "number") }))}
            rows={r.rows.map((row) => row.map((v, i) => (r.money.includes(i) && typeof v === "number" ? inr(Math.round(v * 100)) : String(v))))} empty="No data for this period." />
        </Panel>
      </div>
    </>
  );
}
