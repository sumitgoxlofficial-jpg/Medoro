"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { updateFollowUp } from "../../../growth-actions";
import { Empty, Panel, Tabs, btn, selSm, td, th, useRun } from "../../ui";
import { StageBadge, fmtDT, localToIso } from "../kit";

type Row = { id: string; lead: { id: string; code: string; name: string; phone: string | null; city: string; stage: string }; staffName: string; dueAt: string; note: string; status: string; escalatedAt: string | null; overdue: boolean };
type Cal = { month: string; tasks: { id: string; at: string; status: string; lead: { id: string; name: string } }[]; demos: { id: string; at: string; status: string; leadId: string }[] };

export function FollowUpsView({ view, list, cal, month, staff, staffId }: { view: string; list: { overdue: number; rows: Row[] } | null; cal: Cal | null; month: string; staff: { id: string; name: string }[]; staffId: string }) {
  const router = useRouter();
  const { run, busy } = useRun();
  const [moving, setMoving] = useState<{ id: string; at: string } | null>(null);
  const go = (patch: Record<string, string>) => router.push("?" + new URLSearchParams({ view, month, ...(staffId ? { staffId } : {}), ...patch }).toString());
  return (
    <>
      <div className="flex gap-2 flex-wrap items-center">
        <Tabs value={view} options={[["today", "Today"], ["overdue", `Overdue${list?.overdue ? ` (${list.overdue})` : ""}`], ["upcoming", "Upcoming"], ["done", "Done"], ["calendar", "Calendar"]]} onChange={(v) => go({ view: v })} />
        {staff.length ? <select className={selSm} value={staffId} onChange={(e) => go({ staffId: e.target.value })}><option value="">Everyone in view</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select> : null}
      </div>
      {list ? (
        <Panel>
          {list.rows.length ? (
            <div className="overflow-auto"><table className="w-full border-collapse min-w-[820px] text-[13.5px]">
              <thead><tr className="bg-[#FAFBFB] text-muted text-[12px]"><th className={th}>Due</th><th className={th}>Pharmacy</th><th className={th}>Employee</th><th className={th}>Note</th><th className={th}>Stage</th><th className={th}></th></tr></thead>
              <tbody>{list.rows.map((r) => (
                <tr key={r.id} className={r.overdue ? "bg-[#FFF8F7]" : ""}>
                  <td className={td + " whitespace-nowrap"}>{fmtDT(r.dueAt)}{r.escalatedAt ? <div className="text-[11.5px] text-[#C0362C] font-semibold">Escalated</div> : null}</td>
                  <td className={td}><Link href={`/staff/growth/call/${r.lead.id}`} className="font-semibold hover:text-teal">{r.lead.name}</Link><div className="text-muted text-[12px]">{r.lead.city}</div></td>
                  <td className={td}>{r.staffName}</td><td className={td}>{r.note}</td><td className={td}><StageBadge s={r.lead.stage} /></td>
                  <td className={td + " whitespace-nowrap"}>{r.status === "open" ? (moving?.id === r.id ? (
                    <span className="inline-flex gap-1"><input type="datetime-local" className={selSm} value={moving.at} onChange={(e) => setMoving({ id: r.id, at: e.target.value })} /><button className={btn} disabled={busy || !moving.at} onClick={() => run(() => updateFollowUp(r.id, { action: "reschedule", dueAt: localToIso(moving.at) }), () => setMoving(null))}>Save</button></span>
                  ) : (<span className="inline-flex gap-1"><Link href={`/staff/growth/call/${r.lead.id}`} className={btn}>Call</Link><button className={btn} disabled={busy} onClick={() => run(() => updateFollowUp(r.id, { action: "complete" }))}>Done</button><button className={btn} onClick={() => setMoving({ id: r.id, at: "" })}>Move</button></span>)) : <span className="text-muted">{r.status}</span>}</td>
                </tr>
              ))}</tbody>
            </table></div>
          ) : <Empty>Nothing here.</Empty>}
        </Panel>
      ) : cal ? <Calendar cal={cal} onMonth={(m) => go({ month: m })} /> : null}
    </>
  );
}

function Calendar({ cal, onMonth }: { cal: Cal; onMonth: (m: string) => void }) {
  const [y, m] = cal.month.split("-").map(Number);
  const first = new Date(Date.UTC(y, m - 1, 1));
  const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const lead = (first.getUTCDay() + 6) % 7;
  const shift = (d: number) => { const t = new Date(Date.UTC(y, m - 1 + d, 1)); return t.toISOString().slice(0, 7); };
  const dayOf = (iso: string) => new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 10);
  const cells = Array.from({ length: lead + days }, (_, i) => (i < lead ? null : i - lead + 1));
  return (
    <Panel title={first.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" })} right={<><button className={btn} onClick={() => onMonth(shift(-1))}>‹ Previous</button><button className={btn} onClick={() => onMonth(shift(1))}>Next ›</button></>}>
      <div className="grid grid-cols-7 text-[12px] text-muted text-center py-1.5 border-b border-[#EEF0F2]">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => <span key={d}>{d}</span>)}</div>
      <div className="grid grid-cols-7">
        {cells.map((d, i) => {
          if (!d) return <div key={i} className="min-h-[92px] border-b border-r border-[#F1F3F4] bg-[#FAFBFB]" />;
          const iso = `${cal.month}-${String(d).padStart(2, "0")}`;
          const tasks = cal.tasks.filter((t) => dayOf(t.at) === iso), demos = cal.demos.filter((x) => dayOf(x.at) === iso);
          return (
            <div key={i} className="min-h-[92px] border-b border-r border-[#F1F3F4] p-1.5 text-[11.5px] flex flex-col gap-0.5 min-w-0">
              <span className="font-semibold text-[12px]">{d}</span>
              {demos.map((x) => <Link key={x.id} href={`/staff/growth/leads/${x.leadId}`} className="truncate rounded px-1 bg-[#EFEBFA] text-[#5B45B0]">Demo {new Date(x.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</Link>)}
              {tasks.slice(0, 4).map((t) => <Link key={t.id} href={`/staff/growth/call/${t.lead.id}`} className={`truncate rounded px-1 ${t.status === "done" ? "bg-[#E3F5EC] text-[#18794E] line-through" : "bg-[#E1F1EF] text-teal"}`}>{t.lead.name}</Link>)}
              {tasks.length > 4 ? <span className="text-muted">+{tasks.length - 4} more</span> : null}
            </div>
          );
        })}
      </div>
    </Panel>
  );
}
