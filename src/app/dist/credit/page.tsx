import Link from "next/link";
import { requireDistCtx, distView } from "@/domain/distribution/context";
import { ageingTotals, receivables } from "@/domain/distribution/receivables";
import { listSalesmen, listTerritories } from "@/domain/distribution/masters";
import { AGE_BUCKETS } from "@/domain/distribution/rules/ageing";
import { inr } from "@/lib/money";
import { DataTable, PageHead, Panel, Pill, Stat, STATUS_TONE } from "../_ui/ui";

export const metadata = { title: "Credit control" };

export default async function Page({ searchParams }: { searchParams: Promise<{ salesman?: string; territory?: string; risk?: string }> }) {
  const ctx = await requireDistCtx();
  distView(ctx, "payments", "approve", "reports");
  const sp = await searchParams;
  const [all, sms, terr] = await Promise.all([receivables(ctx, { salesmanId: sp.salesman, territoryId: sp.territory }), listSalesmen(ctx), listTerritories(ctx)]);
  const rows = all.filter((r) => r.balance !== 0 && (!sp.risk || r.risk.level === sp.risk));
  const ag = ageingTotals(rows);
  return (
    <>
      <PageHead title="Customer credit management" sub="Bill-wise outstanding (oldest bills settled first), ageing, limits and a transparent risk score. Holds and blocks are set on the chemist." />
      <div className="grid gap-3 grid-cols-2 lg:grid-cols-6 mb-4">
        <Stat label="Outstanding" value={inr(rows.reduce((a, r) => a + Math.max(0, r.balance), 0))} />
        <Stat label="Overdue" value={inr(rows.reduce((a, r) => a + r.overdue, 0))} tone="amber" />
        {AGE_BUCKETS.slice(1).map((b) => <Stat key={b} label={`${b} days`} value={inr(ag[b])} tone={b === "120+" ? "red" : "navy"} />)}
      </div>
      <Panel pad={false} title={`${rows.length} chemists with a balance`} right={
        <form className="flex gap-1.5 flex-wrap">
          <select name="salesman" defaultValue={sp.salesman ?? ""} className="h-8 border border-[#C9D2DE] rounded px-1 text-[12.5px]"><option value="">All salesmen</option>{sms.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select>
          <select name="territory" defaultValue={sp.territory ?? ""} className="h-8 border border-[#C9D2DE] rounded px-1 text-[12.5px]"><option value="">All territories</option>{terr.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select>
          <select name="risk" defaultValue={sp.risk ?? ""} className="h-8 border border-[#C9D2DE] rounded px-1 text-[12.5px]"><option value="">Any risk</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option></select>
          <button className="h-8 px-2 border border-[#C9D2DE] rounded text-[12.5px]">Filter</button>
        </form>}>
        <DataTable cols={[{ label: "Chemist" }, { label: "Limit", num: true }, { label: "Balance", num: true }, { label: "Used", num: true }, { label: "Overdue", num: true }, { label: "Oldest", num: true }, { label: "Status" }, { label: "Risk" }, { label: "Why" }]}
          rows={rows.map((r) => [<Link key="n" href={`/dist/chemists/${r.customerId}`} className="font-medium">{r.name}</Link>, inr(r.limit), inr(r.balance), r.limit ? `${Math.round((r.balance / r.limit) * 100)}%` : "—", inr(r.overdue), `${r.oldestDays} d`,
            <Pill key="s" tone={STATUS_TONE[r.status]}>{r.status}</Pill>, <Pill key="r" tone={STATUS_TONE[r.risk.level]}>{`${r.risk.level} ${r.risk.score}`}</Pill>, <span key="w" className="text-[12px] text-[#5B6B82]">{r.risk.factors.join("; ")}</span>])} empty="No outstanding balances." />
      </Panel>
    </>
  );
}
