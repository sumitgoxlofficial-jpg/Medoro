"use client";
import { useState } from "react";
import Link from "next/link";
import { INDIAN_STATES } from "@/staff/growth/constants";
import { assignByTerritory, distribute, reassignFrom } from "../../../growth-actions";
import { Empty, Kpi, Panel, btn, btnPrimary, fieldCls, lbl, td, th, useRun } from "../../ui";
import { fmtDT, localToIso } from "../kit";

type O = { unassigned: number; employees: { id: string; name: string; empNo: string; active: number; pending: number; overdueFollowUps: number; overdueDeadlines: number }[]; inactive: { staffId: string; name: string; leads: number }[] };
type H = { id: string; action: string; at: string; reason: string; from: string; to: string; by: string; lead?: { id: string; code: string; name: string } }[];

export function DistributionView({ o, staff, history, admin }: { o: O; staff: { id: string; name: string; empNo: string }[]; history: H; admin: boolean }) {
  const { run, busy } = useRun();
  const [f, setF] = useState({ state: "", district: "", city: "", pin: "", stage: "", minScore: "", onlyUnassigned: true });
  const [pick, setPick] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<"equal" | "balance">("equal");
  const [due, setDue] = useState("");
  const [reassign, setReassign] = useState(false);
  const [moveTo, setMoveTo] = useState<Record<string, Set<string>>>({});
  const filter = { state: f.state || undefined, district: f.district || undefined, city: f.city || undefined, pin: f.pin || undefined, stage: f.stage || undefined, minScore: f.minScore || undefined, staffId: f.onlyUnassigned ? "none" : undefined };
  const toggle = (id: string) => setPick((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const totals = o.employees.reduce((t, e) => ({ active: t.active + e.active, pending: t.pending + e.pending, fu: t.fu + e.overdueFollowUps }), { active: 0, pending: 0, fu: 0 });
  return (
    <>
      <div className="grid gap-3 grid-cols-2 min-[1000px]:grid-cols-4">
        <Kpi l="Waiting to be assigned" v={o.unassigned.toLocaleString("en-IN")} />
        <Kpi l="Actively assigned" v={totals.active.toLocaleString("en-IN")} d={`${o.employees.length} employees`} />
        <Kpi l="Assigned, never called" v={totals.pending.toLocaleString("en-IN")} />
        <Kpi l="Overdue follow-ups" v={String(totals.fu)} c={totals.fu ? "#C0362C" : undefined} />
      </div>

      <Panel title="Distribute leads" sub="Pick which leads, then who gets them. Each lead has one owner; history and call reports are kept on reassignment.">
        <div className="grid gap-2.5 p-4 grid-cols-2 min-[900px]:grid-cols-4">
          <label className={lbl}>State<select className={fieldCls} value={f.state} onChange={(e) => setF({ ...f, state: e.target.value })}><option value="">All states</option>{INDIAN_STATES.map((s) => <option key={s}>{s}</option>)}</select></label>
          <label className={lbl}>District<input className={fieldCls} value={f.district} onChange={(e) => setF({ ...f, district: e.target.value })} /></label>
          <label className={lbl}>City<input className={fieldCls} value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></label>
          <label className={lbl}>PIN code<input className={fieldCls} value={f.pin} maxLength={6} onChange={(e) => setF({ ...f, pin: e.target.value })} /></label>
          <label className={lbl}>Minimum score<input className={fieldCls} inputMode="numeric" value={f.minScore} onChange={(e) => setF({ ...f, minScore: e.target.value })} /></label>
          <label className={lbl}>Deadline (optional)<input type="datetime-local" className={fieldCls} value={due} onChange={(e) => setDue(e.target.value)} /></label>
          <label className="flex gap-2 items-center text-[13px] col-span-2"><input type="checkbox" checked={f.onlyUnassigned} onChange={(e) => setF({ ...f, onlyUnassigned: e.target.checked })} />Only unassigned leads</label>
          {!f.onlyUnassigned ? <label className="flex gap-2 items-center text-[13px] col-span-2"><input type="checkbox" checked={reassign} onChange={(e) => setReassign(e.target.checked)} />Move leads that already have an owner</label> : null}
        </div>
        <div className="px-4 pb-2 text-[12.5px] text-muted">Employees ({pick.size} chosen)</div>
        <div className="flex gap-2 flex-wrap px-4 pb-3">
          {staff.map((s) => <button key={s.id} type="button" onClick={() => toggle(s.id)} className={`${btn} ${pick.has(s.id) ? "!border-teal !bg-teal-tint" : ""}`}>{s.name} <span className="text-muted font-normal">· {o.employees.find((e) => e.id === s.id)?.active ?? 0}</span></button>)}
          {staff.length ? <button type="button" className={btn} onClick={() => setPick(new Set(staff.map((s) => s.id)))}>All</button> : <span className="text-muted text-[13px]">No employees can receive leads yet. Give people a Sales role in My employees.</span>}
        </div>
        <div className="flex gap-2 flex-wrap items-center px-4 pb-4">
          <select className={fieldCls + " !w-auto"} value={mode} onChange={(e) => setMode(e.target.value as "equal")}><option value="equal">Equal split (e.g. 300 → 100 each)</option><option value="balance">Balance by current load</option></select>
          <button className={btnPrimary} disabled={busy || !pick.size} onClick={() => run(() => distribute({ filter, staffIds: [...pick], mode, dueAt: due ? localToIso(due) : null, reassign: !f.onlyUnassigned && reassign }), (r) => `${r.assigned} leads assigned: ${Object.entries(r.byStaff).map(([id, n]) => `${staff.find((s) => s.id === id)?.name ?? id} ${n}`).join(", ")}${r.skipped.length ? `; ${r.skipped.length} skipped` : ""}.`)}>Distribute matching leads</button>
          <button className={btn} disabled={busy} onClick={() => run(() => assignByTerritory({ state: f.state || undefined, dueAt: due ? localToIso(due) : null }), (r) => `${r.assigned} unassigned leads given to the employees whose territory matches.`)}>Assign by territory</button>
          <Link className={btn} href="/staff/growth/leads?staffId=none">Pick leads one by one</Link>
        </div>
      </Panel>

      <Panel title="Employees">
        {o.employees.length ? (
          <div className="overflow-auto"><table className="w-full border-collapse min-w-[680px] text-[13.5px]">
            <thead><tr className="bg-[#FAFBFB] text-muted text-[12px]"><th className={th}>Employee</th><th className={th + " text-right"}>Active leads</th><th className={th + " text-right"}>Never called</th><th className={th + " text-right"}>Past deadline</th><th className={th + " text-right"}>Overdue follow-ups</th><th className={th}></th></tr></thead>
            <tbody>{o.employees.map((e) => <tr key={e.id}><td className={td}><strong>{e.name}</strong> <span className="text-muted">· {e.empNo}</span></td><td className={td + " text-right tnum"}>{e.active}</td><td className={td + " text-right tnum"}>{e.pending}</td><td className={td + " text-right tnum"}>{e.overdueDeadlines}</td><td className={td + " text-right tnum " + (e.overdueFollowUps ? "text-[#C0362C] font-semibold" : "")}>{e.overdueFollowUps}</td><td className={td}><Link className="text-teal text-[12.5px]" href={`/staff/growth/leads?staffId=${e.id}`}>Leads</Link></td></tr>)}</tbody>
          </table></div>
        ) : <Empty>No employees yet.</Empty>}
      </Panel>

      {admin && o.inactive.length ? (
        <Panel title="Leads held by people who can’t work them" sub="Deactivated staff or removed from Growth. Their reports stay; the leads move.">
          {o.inactive.map((x) => (
            <div key={x.staffId} className="flex gap-2 items-center flex-wrap px-4 py-3 border-t border-[#F1F3F4] text-[13.5px]">
              <span className="flex-1"><strong>{x.name}</strong> · {x.leads} active leads</span>
              {staff.filter((s) => s.id !== x.staffId).map((s) => <label key={s.id} className="flex gap-1 items-center text-[12.5px]"><input type="checkbox" checked={moveTo[x.staffId]?.has(s.id) ?? false} onChange={() => setMoveTo((m) => { const n = new Set(m[x.staffId] ?? []); if (n.has(s.id)) n.delete(s.id); else n.add(s.id); return { ...m, [x.staffId]: n }; })} />{s.name}</label>)}
              <button className={btn} disabled={busy || !moveTo[x.staffId]?.size} onClick={() => run(() => reassignFrom(x.staffId, [...moveTo[x.staffId]!]), (r) => `${r.assigned} leads moved.`)}>Reassign</button>
            </div>
          ))}
        </Panel>
      ) : null}

      <Panel title="Assignment history">
        {history.length ? (
          <div className="overflow-auto"><table className="w-full border-collapse min-w-[720px] text-[13px]">
            <thead><tr className="bg-[#FAFBFB] text-muted text-[12px]"><th className={th}>When</th><th className={th}>Lead</th><th className={th}>Change</th><th className={th}>By</th><th className={th}>Reason</th></tr></thead>
            <tbody>{history.map((h) => <tr key={h.id}><td className={td + " whitespace-nowrap"}>{fmtDT(h.at)}</td><td className={td}>{h.lead ? <Link className="hover:text-teal" href={`/staff/growth/leads/${h.lead.id}`}>{h.lead.name}</Link> : "—"}</td><td className={td}>{h.action}{h.from ? ` from ${h.from}` : ""}{h.to ? ` to ${h.to}` : ""}</td><td className={td}>{h.by}</td><td className={td}>{h.reason}</td></tr>)}</tbody>
          </table></div>
        ) : <Empty>No assignments yet.</Empty>}
      </Panel>
    </>
  );
}
