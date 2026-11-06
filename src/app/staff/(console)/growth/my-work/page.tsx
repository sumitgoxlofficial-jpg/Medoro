import Link from "next/link";
import { requireGrowth } from "@/staff/growth/access";
import { myDashboard, myLeads } from "@/staff/growth/analytics";
import { displayPhone } from "@/staff/growth/normalize";
import { Empty, Kpi, Panel, btn, td, th } from "../../ui";
import { LeadLink, ScoreChip, StageBadge } from "../kit";
import { fmtD, fmtDT } from "../fmt";

export default async function MyWork({ searchParams }: { searchParams: Promise<{ page?: string; stage?: string }> }) {
  const a = await requireGrowth("calls.make");
  const sp = await searchParams;
  const [m, list] = await Promise.all([myDashboard(a), myLeads(a, { page: sp.page ?? 1, stage: sp.stage, pageSize: 50, sort: "followup" })]);
  const pct = (n: number, t?: number | null) => (t ? `${Math.min(999, Math.round((n / t) * 100))}% of ${t}` : "No target set");
  return (
    <>
      <div className="grid gap-3 grid-cols-2 min-[900px]:grid-cols-4 min-[1300px]:grid-cols-6">
        <Kpi l="Assigned leads" v={String(m.assigned)} d={`${m.todayLeads} new today`} />
        <Kpi l="Calls attempted today" v={String(m.attemptedToday)} d={pct(m.attemptedToday, m.targets.daily?.calls)} />
        <Kpi l="Connected today" v={String(m.connectedToday)} d={`${m.weekCalls} calls this week · ${pct(m.weekCalls, m.targets.weekly?.calls)}`} />
        <Kpi l="Interested pharmacies" v={String(m.interested)} d={`${m.demos} demos scheduled · ${m.trials} on trial`} />
        <Kpi l="Follow-ups due today" v={String(m.dueToday)} d={m.overdue ? `${m.overdue} overdue` : "None overdue"} c={m.overdue ? "#C0362C" : undefined} />
        <Kpi l="Conversions" v={String(m.conversions)} d="All time" c="#18794E" />
      </div>
      <Panel title="My assigned leads" sub="Sorted by next follow-up" right={<Link href="/staff/growth/call" className={btn}>Open calling workspace</Link>}>
        {list.rows.length ? (
          <div className="overflow-auto"><table className="w-full border-collapse min-w-[860px] text-[13.5px]">
            <thead><tr className="bg-[#FAFBFB] text-muted text-[12px]"><th className={th}>Pharmacy</th><th className={th}>Phone</th><th className={th}>Location</th><th className={th + " text-right"}>Score</th><th className={th}>Status</th><th className={th}>Last call</th><th className={th}>Next follow-up</th><th className={th}>Call</th></tr></thead>
            <tbody>{list.rows.map((r) => (
              <tr key={r.id}>
                <td className={td}><LeadLink id={r.id} name={r.name} code={r.code} /></td>
                <td className={td + " tnum whitespace-nowrap"}>{r.phone ? displayPhone(r.phone) : "—"}</td>
                <td className={td}>{[r.city, r.district].filter(Boolean).join(", ")}{r.pin ? <span className="text-muted"> · {r.pin}</span> : null}</td>
                <td className={td + " text-right"}><ScoreChip n={r.score} /></td>
                <td className={td}><StageBadge s={r.stage} /></td>
                <td className={td + " whitespace-nowrap"}>{fmtD(r.lastContactedAt)}</td>
                <td className={td + " whitespace-nowrap"}>{fmtDT(r.nextFollowUpAt)}</td>
                <td className={td}>{r.stage === "DO_NOT_CONTACT" ? <span className="text-muted text-[12px]">Do not contact</span> : <Link className={btn} href={`/staff/growth/call/${r.id}`}>Call</Link>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>No leads assigned to you yet. Your manager assigns them from Lead distribution.</Empty>}
        {list.total > list.pageSize ? <div className="flex gap-2 justify-end px-4 py-3 text-[13px]">{list.page > 1 ? <Link className={btn} href={`?page=${list.page - 1}`}>Previous</Link> : null}<span className="text-muted">Page {list.page} of {Math.ceil(list.total / list.pageSize)}</span>{list.page * list.pageSize < list.total ? <Link className={btn} href={`?page=${list.page + 1}`}>Next</Link> : null}</div> : null}
      </Panel>
      <p className="text-[12px] text-muted px-1">Calls go out from your own phone and SIM. Medoro opens your dialer and records only what you report.</p>
    </>
  );
}
