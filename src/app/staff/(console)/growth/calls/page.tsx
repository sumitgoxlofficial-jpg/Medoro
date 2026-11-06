import Link from "next/link";
import { assignableStaff, requireGrowth } from "@/staff/growth/access";
import { callHistory } from "@/staff/growth/calls";
import { OUTCOMES, outcomeLabel } from "@/staff/growth/constants";
import { displayPhone } from "@/staff/growth/normalize";
import { Empty, Panel, btn, btnPrimary, fieldCls, lbl, td, th } from "../../ui";
import { fmtDT } from "../fmt";

export default async function Calls({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const a = await requireGrowth("calls.make");
  const sp = await searchParams;
  const [h, staff] = await Promise.all([callHistory(a, { staffId: sp.staffId || undefined, from: sp.from || undefined, to: sp.to || undefined, outcome: sp.outcome || undefined, page: sp.page ?? 1 }), a.growthRole === "sales" ? Promise.resolve([]) : assignableStaff(a)]);
  return (
    <Panel title="Call history" sub={`${h.total} call sessions. “Not reported” means the dialer was opened but no report was submitted.`}>
      <form method="get" className="flex gap-2.5 p-4 flex-wrap items-end">
        {staff.length ? <label className={lbl}>Employee<select name="staffId" defaultValue={sp.staffId ?? ""} className={fieldCls}><option value="">Everyone</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label> : null}
        <label className={lbl}>From<input type="date" name="from" defaultValue={sp.from} className={fieldCls} /></label>
        <label className={lbl}>To<input type="date" name="to" defaultValue={sp.to} className={fieldCls} /></label>
        <label className={lbl}>Outcome<select name="outcome" defaultValue={sp.outcome ?? ""} className={fieldCls}><option value="">Any</option><option value="unreported">Not reported</option>{OUTCOMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
        <button className={btnPrimary}>Filter</button><Link href="/staff/growth/calls" className={btn}>Clear</Link>
      </form>
      {h.rows.length ? (
        <div className="overflow-auto"><table className="w-full border-collapse min-w-[900px] text-[13.5px]">
          <thead><tr className="bg-[#FAFBFB] text-muted text-[12px]"><th className={th}>Dialer opened</th><th className={th}>Reported</th><th className={th}>Employee</th><th className={th}>Pharmacy</th><th className={th}>Number</th><th className={th}>Outcome</th><th className={th}>Notes</th><th className={th}>Follow-up</th></tr></thead>
          <tbody>{h.rows.map((r) => (
            <tr key={r.id}>
              <td className={td + " whitespace-nowrap"}>{fmtDT(r.launchedAt)}</td><td className={td + " whitespace-nowrap"}>{r.reportedAt ? fmtDT(r.reportedAt) : <span className="text-[#94570A]">Not reported</span>}</td>
              <td className={td}>{r.staffName}</td><td className={td}><Link className="font-semibold hover:text-teal" href={`/staff/growth/leads/${r.lead.id}`}>{r.lead.name}</Link></td>
              <td className={td + " tnum whitespace-nowrap"}>{r.phone.startsWith("+") ? displayPhone(r.phone) : r.phone}</td><td className={td}>{r.outcome ? outcomeLabel(r.outcome) : "—"}</td>
              <td className={td + " max-w-[320px]"}>{r.notes}</td><td className={td + " whitespace-nowrap"}>{fmtDT(r.followUpAt)}</td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : <Empty>No calls match.</Empty>}
      {h.total > 50 ? <div className="flex gap-2 justify-end px-4 py-3 text-[13px]">{h.page > 1 ? <Link className={btn} href={`?${new URLSearchParams({ ...sp, page: String(h.page - 1) } as Record<string, string>)}`}>Previous</Link> : null}<span className="text-muted">Page {h.page}</span>{h.page * 50 < h.total ? <Link className={btn} href={`?${new URLSearchParams({ ...sp, page: String(h.page + 1) } as Record<string, string>)}`}>Next</Link> : null}</div> : null}
    </Panel>
  );
}
