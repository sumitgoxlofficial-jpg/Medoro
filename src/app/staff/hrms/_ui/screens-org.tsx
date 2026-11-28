"use client";
import { useMemo, useState } from "react";
import type { Data } from "@/staff/hrms/screens";
import { employeeTimeline } from "../actions";
import { Avatar, Card, Empty, Grid, Modal, Pill, Stat, Table, btnCls, dayLabel, inputCls, tdCls, useRun } from "./kit";

type D = Data<"orgchart">;
type Node = D["chart"]["nodes"][number];
type Event = D["history"][number];

const TYPE: Record<string, [string, "green" | "blue" | "amber" | "gray" | "red" | "purple"]> = {
  joined: ["Joined", "green"], updated: ["Updated", "gray"], manager: ["New manager", "blue"], transfer: ["Transfer", "purple"], promotion: ["Promotion", "green"], pay: ["Pay change", "amber"], exit: ["Exit", "red"], reactivated: ["Reactivated", "blue"],
};
const FIELD: Record<string, string> = { role: "System access", dept: "Department", designation: "Designation", empType: "Employment type", location: "Location", managerId: "Reports to", ctc: "Annual CTC", incentivePct: "Incentive %", shiftStart: "Shift start" };
const show = (k: string, v: unknown) => (v === null || v === "" || v === undefined ? "—" : k === "ctc" ? `₹${Number(v).toLocaleString("en-IN")}` : String(v));

/** One person's employment history, newest first. */
export function History({ rows }: { rows: Event[] }) {
  if (!rows.length) return <Empty>No changes recorded yet. Changes made from now on are kept here.</Empty>;
  return (
    <ol className="flex flex-col gap-2.5 m-0 p-0 list-none">
      {rows.map((e) => (
        <li key={e.id} className="border border-[#E2E8F0] rounded-xl px-3.5 py-2.5">
          <div className="flex items-center gap-2 flex-wrap"><Pill tone={TYPE[e.type]?.[1] ?? "gray"}>{TYPE[e.type]?.[0] ?? e.type}</Pill><strong className="text-[13px]">{dayLabel(e.effective)}</strong><span className="text-[12px] text-[#64748B]">by {e.by}</span></div>
          {Object.keys(e.changes).length ? <ul className="mt-1.5 text-[12.5px] text-[#334155] list-none p-0 m-0 flex flex-col gap-0.5">{Object.entries(e.changes).map(([k, [a, b]]) => <li key={k}><span className="text-[#64748B]">{FIELD[k] ?? k}:</span> {show(k, a)} → <strong>{show(k, b)}</strong></li>)}</ul> : null}
          {e.hiddenPay ? <p className="text-[11.5px] text-[#94A3B8] mt-1">A pay change is recorded; it is shown to Payroll only.</p> : null}
          {e.note ? <p className="text-[12px] text-[#475569] mt-1">{e.note}</p> : null}
        </li>
      ))}
    </ol>
  );
}

function Branch({ node, kids, depth, open, toggle, onPick, me }: { node: Node; kids: Map<string | null, Node[]>; depth: number; open: Set<string>; toggle: (id: string) => void; onPick?: (n: Node) => void; me: string }) {
  const children = kids.get(node.id) ?? [];
  const expanded = open.has(node.id);
  return (
    <li className="m-0">
      <div className="flex items-center gap-2.5 py-1.5" style={{ paddingLeft: depth * 22 }}>
        {children.length ? <button type="button" className="size-6 rounded-md border border-[#E2E8F0] text-[12px] flex-none" aria-expanded={expanded} aria-label={`${expanded ? "Hide" : "Show"} ${node.name}’s team`} onClick={() => toggle(node.id)}>{expanded ? "−" : "+"}</button> : <span className="size-6 flex-none" />}
        <Avatar name={node.name} photo={node.photo} size={30} />
        <span className="flex flex-col leading-tight min-w-0">
          <span className="text-[13.5px] font-semibold truncate">{node.name}{node.id === me ? <span className="text-[11px] text-[#0B5E5B] font-semibold"> · you</span> : null}</span>
          <span className="text-[12px] text-[#64748B] truncate">{[node.designation, node.dept].filter(Boolean).join(" · ") || node.empNo}{node.reports ? ` · ${node.reports} report${node.reports === 1 ? "" : "s"}` : ""}</span>
        </span>
        {onPick ? <button type="button" className={btnCls + " ml-auto !py-1"} onClick={() => onPick(node)}>History</button> : null}
      </div>
      {expanded && children.length ? <ul className="m-0 p-0 list-none">{children.map((c) => <Branch key={c.id} node={c} kids={kids} depth={depth + 1} open={open} toggle={toggle} onPick={onPick} me={me} />)}</ul> : null}
    </li>
  );
}

/** Org chart for everyone (what the visibility rules allow), organisation health and employee history for HR. */
export function OrgScreen({ d }: { d: D }) {
  const { run, busy } = useRun();
  const [q, setQ] = useState("");
  const [pick, setPick] = useState<{ node: Node; rows: Event[] } | null>(null);
  const kids = useMemo(() => {
    const m = new Map<string | null, Node[]>();
    for (const n of d.chart.nodes) { const k = n.managerId; m.set(k, [...(m.get(k) ?? []), n]); }
    return m;
  }, [d.chart.nodes]);
  // Everyone above the signed-in person starts open, so they see where they sit.
  const [open, setOpen] = useState<Set<string>>(() => {
    const s = new Set<string>(), byId = new Map(d.chart.nodes.map((n) => [n.id, n]));
    let at = byId.get(d.chart.me);
    for (let i = 0; at && i < 64; i++) { s.add(at.id); at = at.managerId ? byId.get(at.managerId) : undefined; }
    for (const r of kids.get(null) ?? []) s.add(r.id);
    return s;
  });
  const toggle = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const found = q.trim() ? d.chart.nodes.filter((n) => `${n.name} ${n.empNo} ${n.designation} ${n.dept}`.toLowerCase().includes(q.trim().toLowerCase())) : [];
  const onPick = d.hr ? (n: Node) => run(() => employeeTimeline(n.id), (rows) => { setPick({ node: n, rows }); }) : undefined;
  const h = d.health;
  return <>
    {h ? <Grid>
      <Stat l="Active headcount" v={h.headcount} />
      <Stat l="Managers" v={h.managers} sub={`Average ${h.avgSpan} direct reports`} />
      <Stat l="No reporting manager" v={h.noManager.length} c={h.noManager.length ? "#B45309" : undefined} />
      <Stat l="Manager has left" v={h.orphaned.length} c={h.orphaned.length ? "#DC2626" : undefined} sub="Active people reporting to someone who left" />
    </Grid> : null}
    <Card title="Organisation chart" sub={d.hr ? "Everyone, by reporting line. Open History for what changed and when." : "Your department, your manager, the people who report to you and HR."} right={<input className={inputCls + " !w-56"} placeholder="Find a person…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a person" />}>
      <div className="px-5 pb-4">
        {q.trim() ? (found.length ? <ul className="m-0 p-0 list-none">{found.map((n) => <Branch key={n.id} node={n} kids={new Map()} depth={0} open={new Set()} toggle={() => {}} onPick={onPick} me={d.chart.me} />)}</ul> : <Empty>Nobody matches.</Empty>)
          : (kids.get(null) ?? []).length ? <ul className="m-0 p-0 list-none">{(kids.get(null) ?? []).map((n) => <Branch key={n.id} node={n} kids={kids} depth={0} open={open} toggle={toggle} onPick={onPick} me={d.chart.me} />)}</ul> : <Empty>No one to show yet.</Empty>}
        {busy ? <p className="text-[12px] text-[#64748B]">Loading…</p> : null}
      </div>
    </Card>
    {h ? <Grid n={2}>
      <Card title="Headcount by department"><Table head={["Department", "People"]}>{h.depts.map((x) => <tr key={x.name}><td className={tdCls}>{x.name}</td><td className={tdCls}>{x.n}</td></tr>)}</Table></Card>
      <Card title="Reporting lines to fix" sub={`People without a manager, managers who left, and spans wider than ${12} people.`}>
        <Table head={["Person", "Issue"]} empty="Nothing to fix.">
          {h.orphaned.map((x) => <tr key={"o" + x.id}><td className={tdCls}>{x.name} <span className="text-[12px] text-[#94A3B8]">{x.empNo}</span></td><td className={tdCls}><Pill tone="red">Manager {x.manager} has left</Pill></td></tr>)}
          {h.wide.map((x) => <tr key={"w" + x.id}><td className={tdCls}>{x.name}</td><td className={tdCls}><Pill tone="amber">{x.n} direct reports</Pill></td></tr>)}
          {h.noManager.map((x) => <tr key={"n" + x.id}><td className={tdCls}>{x.name} <span className="text-[12px] text-[#94A3B8]">{x.empNo}</span></td><td className={tdCls}><Pill tone="gray">No reporting manager</Pill></td></tr>)}
        </Table>
      </Card>
    </Grid> : null}
    <Card title="My employment history" sub="Every change to your role, department, manager and pay, with the date and who made it." pad><History rows={d.history} /></Card>
    {pick ? <Modal title={`${pick.node.name} · employment history`} onClose={() => setPick(null)} wide><History rows={pick.rows} /></Modal> : null}
  </>;
}
