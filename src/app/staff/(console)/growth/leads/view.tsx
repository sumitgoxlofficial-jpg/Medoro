"use client";
import { useState } from "react";
import Link from "next/link";
import { Download, Plus, UserPlus } from "lucide-react";
import { INDIAN_STATES, STAGES, VERIFICATION_LABEL } from "@/staff/growth/constants";
import { displayPhone } from "@/staff/growth/normalize";
import { assignLeads, createLead, exportLeads, withdrawLeads } from "../../../growth-actions";
import { Empty, Panel, btn, btnPrimary, fieldCls, lbl, td, th, useRun } from "../../ui";
import { LeadLink, ScoreChip, StageBadge, VerifyBadge, downloadText, fmtD, localToIso } from "../kit";

type Row = { id: string; code: string; name: string; phone: string | null; phoneRaw: string; city: string; district: string; state: string; pin: string; verification: string; score: number; stage: string; source: string; assignee: string; lastContactedAt: string | null; nextFollowUpAt: string | null; possibleDuplicate: boolean };
type Props = {
  list: { total: number; page: number; pageSize: number; rows: Row[] };
  facets: { states: { state: string; n: number }[]; sources: { id: string; name: string }[] };
  staff: { id: string; name: string; empNo: string }[];
  filter: Record<string, string | undefined>;
  can: { assign: boolean; create: boolean; export: boolean };
};

export function LeadsView({ list, facets, staff, filter, can }: Props) {
  const { run, busy } = useRun();
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [to, setTo] = useState("");
  const [due, setDue] = useState("");
  const [reassign, setReassign] = useState(false);
  const [adding, setAdding] = useState(false);
  const all = list.rows.length > 0 && list.rows.every((r) => sel.has(r.id));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const qs = (patch: Record<string, string | number | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries({ ...filter, ...patch })) if (v !== undefined && v !== "") p.set(k, String(v)); return "?" + p.toString(); };
  const pages = Math.max(1, Math.ceil(list.total / list.pageSize));
  const doExport = () => {
    const purpose = window.prompt("What is this export for? (kept in the audit log)");
    if (!purpose) return;
    run(() => exportLeads(filter, purpose), (r) => { downloadText(`medoro-leads-${new Date().toISOString().slice(0, 10)}.csv`, r.csv); return `${r.count} leads exported.`; });
  };

  return (
    <>
      <Panel title="Find pharmacy leads" sub={`${list.total.toLocaleString("en-IN")} leads match`} right={<>
        {can.create ? <button className={btn} onClick={() => setAdding((x) => !x)}><Plus size={14} />Add lead</button> : null}
        {can.export ? <button className={btn} disabled={busy} onClick={doExport}><Download size={14} />Export CSV</button> : null}
      </>}>
        <form method="get" className="grid gap-2.5 p-4 grid-cols-2 min-[800px]:grid-cols-4 min-[1200px]:grid-cols-6">
          <label className={lbl + " col-span-2"}>Name, phone, code or city<input name="q" defaultValue={filter.q} className={fieldCls} placeholder="e.g. Shivam or 98230…" /></label>
          <label className={lbl}>State<select name="state" defaultValue={filter.state ?? ""} className={fieldCls}><option value="">All states</option>{INDIAN_STATES.map((s) => <option key={s} value={s}>{s}{facets.states.find((x) => x.state === s) ? ` (${facets.states.find((x) => x.state === s)!.n})` : ""}</option>)}</select></label>
          <label className={lbl}>District<input name="district" defaultValue={filter.district} className={fieldCls} /></label>
          <label className={lbl}>City<input name="city" defaultValue={filter.city} className={fieldCls} /></label>
          <label className={lbl}>PIN code<input name="pin" defaultValue={filter.pin} className={fieldCls} inputMode="numeric" maxLength={6} /></label>
          <label className={lbl}>Website<input name="website" defaultValue={filter.website} className={fieldCls} placeholder="domain" /></label>
          <label className={lbl}>Verification<select name="verification" defaultValue={filter.verification ?? ""} className={fieldCls}><option value="">Any</option>{Object.entries(VERIFICATION_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          <label className={lbl}>Stage<select name="stage" defaultValue={filter.stage ?? ""} className={fieldCls}><option value="">Any</option>{STAGES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select></label>
          {staff.length ? <label className={lbl}>Employee<select name="staffId" defaultValue={filter.staffId ?? ""} className={fieldCls}><option value="">Anyone</option><option value="none">Unassigned</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label> : null}
          <label className={lbl}>Source<select name="sourceId" defaultValue={filter.sourceId ?? ""} className={fieldCls}><option value="">Any</option>{facets.sources.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
          <label className={lbl}>Phone<select name="phone" defaultValue={filter.phone ?? ""} className={fieldCls}><option value="">Any</option><option value="yes">Has phone</option><option value="no">Missing phone</option></select></label>
          <label className={lbl}>Sort<select name="sort" defaultValue={filter.sort ?? "recent"} className={fieldCls}><option value="recent">Newest</option><option value="score">Score</option><option value="name">Name</option><option value="followup">Next follow-up</option></select></label>
          <div className="flex gap-2 items-end"><button className={btnPrimary}>Search</button><Link href="/staff/growth/leads" className={btn}>Clear</Link></div>
        </form>
        {adding ? <AddLead onDone={() => setAdding(false)} /> : null}
      </Panel>

      {can.assign && sel.size ? (
        <Panel title={`${sel.size} selected`}>
          <div className="flex gap-2.5 p-4 flex-wrap items-end">
            <label className={lbl}>Assign to<select className={fieldCls} value={to} onChange={(e) => setTo(e.target.value)}><option value="">Choose employee</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.empNo}</option>)}</select></label>
            <label className={lbl}>Deadline (optional)<input type="datetime-local" className={fieldCls} value={due} onChange={(e) => setDue(e.target.value)} /></label>
            <label className="flex gap-2 items-center text-[13px] pb-2"><input type="checkbox" checked={reassign} onChange={(e) => setReassign(e.target.checked)} />Reassign leads that already have an owner</label>
            <button className={btnPrimary} disabled={busy || !to} onClick={() => run(() => assignLeads({ leadIds: [...sel], staffId: to, dueAt: due ? localToIso(due) : null, reassign }), (r) => { setSel(new Set()); return `${r.assigned} assigned${r.skipped.length ? `, ${r.skipped.length} skipped (${r.skipped[0].reason})` : ""}.`; })}><UserPlus size={15} />Assign</button>
            <button className={btn} disabled={busy} onClick={() => { const why = window.prompt("Reason for withdrawing these assignments?"); if (why) run(() => withdrawLeads([...sel], why), (n) => { setSel(new Set()); return `${n} withdrawn.`; }); }}>Withdraw</button>
          </div>
        </Panel>
      ) : null}

      <Panel>
        {list.rows.length ? (
          <div className="overflow-auto"><table className="w-full border-collapse min-w-[1000px] text-[13.5px]">
            <thead><tr className="bg-[#FAFBFB] text-muted text-[12px]">
              {can.assign ? <th className={th + " w-8"}><input type="checkbox" aria-label="Select all on this page" checked={all} onChange={() => setSel(all ? new Set() : new Set(list.rows.map((r) => r.id)))} /></th> : null}
              <th className={th}>Pharmacy</th><th className={th}>Phone</th><th className={th}>Location</th><th className={th}>Verification</th><th className={th + " text-right"}>Score</th><th className={th}>Stage</th><th className={th}>Assigned to</th><th className={th}>Next follow-up</th><th className={th}>Source</th>
            </tr></thead>
            <tbody>{list.rows.map((r) => (
              <tr key={r.id} className={sel.has(r.id) ? "bg-[#F2F9F8]" : ""}>
                {can.assign ? <td className={td}><input type="checkbox" aria-label={`Select ${r.name}`} checked={sel.has(r.id)} onChange={() => toggle(r.id)} /></td> : null}
                <td className={td}><LeadLink id={r.id} name={r.name} code={r.code} />{r.possibleDuplicate ? <span className="ml-1 text-[11px] text-[#94570A] font-semibold">possible duplicate</span> : null}</td>
                <td className={td + " tnum whitespace-nowrap"}>{r.phone ? displayPhone(r.phone) : <span className="text-muted">{r.phoneRaw || "—"}</span>}</td>
                <td className={td}>{[r.city, r.district, r.state].filter(Boolean).join(", ")}{r.pin ? <span className="text-muted"> · {r.pin}</span> : null}</td>
                <td className={td}><VerifyBadge v={r.verification} /></td>
                <td className={td + " text-right"}><ScoreChip n={r.score} /></td>
                <td className={td}><StageBadge s={r.stage} /></td>
                <td className={td}>{r.assignee || <span className="text-muted">Unassigned</span>}</td>
                <td className={td + " whitespace-nowrap"}>{fmtD(r.nextFollowUpAt)}</td>
                <td className={td + " text-muted text-[12.5px]"}>{r.source}</td>
              </tr>
            ))}</tbody>
          </table></div>
        ) : <Empty>No leads match. Import a list, run discovery, or clear the filters.</Empty>}
        {pages > 1 ? (
          <div className="flex gap-2 items-center justify-end px-4 py-3 border-t border-[#EEF0F2] text-[13px]">
            {list.page > 1 ? <Link className={btn} href={qs({ page: list.page - 1 })}>Previous</Link> : null}
            <span className="text-muted">Page {list.page} of {pages}</span>
            {list.page < pages ? <Link className={btn} href={qs({ page: list.page + 1 })}>Next</Link> : null}
          </div>
        ) : null}
      </Panel>
    </>
  );
}

function AddLead({ onDone }: { onDone: () => void }) {
  const { run, busy } = useRun();
  const [f, setF] = useState({ name: "", category: "RETAIL", ownerName: "", phone: "", email: "", website: "", address: "", city: "", district: "", state: "", pin: "", sourceUrl: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <form className="grid gap-2.5 p-4 border-t border-[#EEF0F2] grid-cols-2 min-[900px]:grid-cols-4" onSubmit={(e) => { e.preventDefault(); run(() => createLead(f), (r) => { onDone(); return `${r.code} added${r.possible ? "; a possible duplicate is waiting in Lead verification" : ""}.`; }); }}>
      <label className={lbl + " col-span-2"}>Pharmacy name *<input required className={fieldCls} value={f.name} onChange={set("name")} /></label>
      <label className={lbl}>Category<select className={fieldCls} value={f.category} onChange={set("category")}><option value="RETAIL">Retail medical store</option><option value="INDEPENDENT">Independent pharmacy</option><option value="CHAIN">Pharmacy chain</option><option value="HOSPITAL">Hospital pharmacy</option><option value="MEDICINE_RETAILER">Medicine retailer</option></select></label>
      <label className={lbl}>Owner / contact (as listed)<input className={fieldCls} value={f.ownerName} onChange={set("ownerName")} /></label>
      <label className={lbl}>Public business phone<input className={fieldCls} value={f.phone} onChange={set("phone")} inputMode="tel" /></label>
      <label className={lbl}>Business email<input className={fieldCls} value={f.email} onChange={set("email")} type="email" /></label>
      <label className={lbl}>Website<input className={fieldCls} value={f.website} onChange={set("website")} /></label>
      <label className={lbl}>Source URL<input className={fieldCls} value={f.sourceUrl} onChange={set("sourceUrl")} placeholder="Where this was found" /></label>
      <label className={lbl + " col-span-2"}>Address<input className={fieldCls} value={f.address} onChange={set("address")} /></label>
      <label className={lbl}>City<input className={fieldCls} value={f.city} onChange={set("city")} /></label>
      <label className={lbl}>District<input className={fieldCls} value={f.district} onChange={set("district")} /></label>
      <label className={lbl}>State<select className={fieldCls} value={f.state} onChange={set("state")}><option value="">Choose</option>{INDIAN_STATES.map((s) => <option key={s}>{s}</option>)}</select></label>
      <label className={lbl}>PIN code<input className={fieldCls} value={f.pin} onChange={set("pin")} inputMode="numeric" maxLength={6} /></label>
      <div className="col-span-2 flex gap-2 items-end"><button className={btnPrimary} disabled={busy}>Save lead</button><button type="button" className={btn} onClick={onDone}>Cancel</button><span className="text-[12px] text-muted">Use only public business details or details given to you.</span></div>
    </form>
  );
}
