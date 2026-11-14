"use client";
import { useRef, useState } from "react";
import type { Data, Shell } from "@/staff/hrms/screens";
import { inr } from "@/staff/hrms/constants";
import { CountUp } from "@/components/welcome-banner";
import { LOST_REASONS, STAGES } from "@/staff/constants";
import { addLead, assignLead, autoAssignLeads, importLeads, logLeadCall, saveLeadSheet, setLeadFollowUp, setLeadStage, setSalesTerms, syncLeadSheet } from "../actions";
import { Avatar, Card, Empty, Field, Grid, Modal, Pill, Stat, Table, Tabs, btnCls, cx, inputCls, primaryCls, tdCls, useRun } from "./kit";

type Lead = Data<"slhome">["leads"][number];
const stageLabel = (id: string) => STAGES.find((s) => s.id === id)?.label ?? id;
const stageColor = (id: string) => STAGES.find((s) => s.id === id)?.fg ?? "#334155";
const waLink = (l: { phone: string; name: string }) => `https://wa.me/91${l.phone}?text=${encodeURIComponent(`Hi, this is regarding Medoro for ${l.name}.`)}`;

function LeadActions({ l }: { l: Lead }) {
  const { run } = useRun();
  const [lost, setLost] = useState(false), [reason, setReason] = useState<string>(LOST_REASONS[0]), [note, setNote] = useState(""), [call, setCall] = useState(false), [fu, setFu] = useState(false), [day, setDay] = useState("");
  return <>
    <div className="flex gap-1.5 flex-wrap items-center">
      <a className={btnCls} href={`tel:+91${l.phone}`}>Call</a><a className={btnCls} href={waLink(l)} target="_blank" rel="noreferrer">WhatsApp</a>
      <button className={btnCls} onClick={() => setCall(true)}>Log call</button>
      {l.stage !== "won" ? <select aria-label={`Stage of ${l.name}`} className="border border-[#CDD2D7] rounded-lg px-2 py-1.5 text-[12.5px] bg-white" value={l.stage} onChange={(e) => (e.target.value === "lost" ? setLost(true) : run(() => setLeadStage(l.id, e.target.value), () => (e.target.value === "won" ? `${l.name} won. The sale is logged.` : "")))}>{STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}</select> : <Pill tone="green">Won</Pill>}
      {l.stage !== "won" && l.stage !== "lost" ? <button className={btnCls} onClick={() => { setDay(l.next ?? ""); setFu(true); }}>{l.follow || "Set follow-up"}</button> : null}
    </div>
    {lost ? <Modal title={`Mark ${l.name} lost`} onClose={() => setLost(false)}><Field label="Why?"><select className={inputCls} value={reason} onChange={(e) => setReason(e.target.value)}>{LOST_REASONS.map((r) => <option key={r}>{r}</option>)}</select></Field><button className={primaryCls} onClick={() => run(() => setLeadStage(l.id, "lost", reason), () => { setLost(false); })}>Mark lost</button></Modal> : null}
    {call ? <Modal title={`Log a call · ${l.name}`} onClose={() => setCall(false)}><Field label="What was said?"><textarea className={inputCls} rows={3} value={note} onChange={(e) => setNote(e.target.value)} /></Field><button className={primaryCls} onClick={() => run(() => logLeadCall(l.id, note), () => { setCall(false); setNote(""); })}>Save · next follow-up in 2 days</button></Modal> : null}
    {fu ? <Modal title="Follow-up date" onClose={() => setFu(false)}><input className={inputCls} type="date" value={day} onChange={(e) => setDay(e.target.value)} /><button className={primaryCls} disabled={!day} onClick={() => run(() => setLeadFollowUp(l.id, day), () => { setFu(false); })}>Save</button></Modal> : null}
  </>;
}
const Stage = ({ s }: { s: string }) => <span className="text-[11px] font-semibold px-2 py-[3px] rounded-full bg-[#F1F5F9] whitespace-nowrap" style={{ color: stageColor(s) }}>{stageLabel(s)}</span>;

export function SalesHome({ d, sh }: { d: Data<"slhome"> } & { sh: Shell }) {
  const { run } = useRun();
  const due = d.leads.filter((l) => l.due), fresh = d.leads.filter((l) => l.stage === "new");
  const pct = d.target ? Math.min(100, Math.round((d.wonMonth * 100) / d.target)) : 0;
  const left = Math.max(0, d.target - d.wonMonth);
  return <>
    {/* Month target banner: progress fills in, the % counts up, a target and rising chart drift behind. */}
    <div className="hr-banner relative overflow-hidden rounded-[18px] px-7 py-6 max-[560px]:px-5 text-white flex gap-4 flex-wrap items-center" style={{ background: "linear-gradient(135deg,#0B5E5B,#14907F)" }}>
      <div aria-hidden className="pointer-events-none absolute inset-0">
        <div className="hr-dots absolute inset-0" />
        <div className="hr-sheen absolute inset-y-0 -left-1/3 w-1/3" />
        <svg viewBox="0 0 120 120" className="hr-spin-slow absolute -left-12 -bottom-20 size-44 opacity-20"><circle cx="60" cy="60" r="56" fill="none" stroke="#fff" strokeWidth="1.5" strokeDasharray="3 7" /><circle cx="60" cy="60" r="36" fill="none" stroke="#fff" strokeWidth="1.5" /><circle cx="60" cy="60" r="16" fill="none" stroke="#fff" strokeWidth="1.5" /><circle cx="60" cy="60" r="5" fill="#F5C451" /></svg>
        <svg viewBox="0 0 200 80" className="absolute right-[18%] bottom-0 w-[220px] max-[700px]:hidden opacity-30"><path className="hr-draw" pathLength={1} d="M4 72l38-22 30 12 40-34 34 10 48-32" fill="none" stroke="#5EEAD4" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /><path d="M184 6l12-0 -2 12" fill="none" stroke="#F5C451" strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        <svg viewBox="0 0 10 10" className="hr-twinkle absolute right-[38%] top-4 size-2.5"><path d="M5 0l1.2 3.8L10 5 6.2 6.2 5 10 3.8 6.2 0 5l3.8-1.2z" fill="#F5C451" /></svg>
        <svg viewBox="0 0 10 10" className="hr-twinkle absolute left-[46%] bottom-4 size-2 [animation-delay:-1.4s]"><path d="M5 0l1.2 3.8L10 5 6.2 6.2 5 10 3.8 6.2 0 5l3.8-1.2z" fill="#5EEAD4" /></svg>
      </div>
      <div className="relative flex-1 min-w-[240px]"><div className="text-[11px] tracking-[.12em] font-semibold text-white/70 uppercase">{new Date().toLocaleDateString("en-IN", { month: "long", timeZone: "Asia/Kolkata" })} target</div><div className="text-[26px] font-bold">{d.wonMonth} of {d.target} pharmacies won</div><div className="h-2 bg-white/20 rounded-full mt-3 overflow-hidden"><div className="hr-fill relative h-full bg-gradient-to-r from-[#5EEAD4] to-white rounded-full" style={{ width: `${pct}%` }} /></div><div className="text-[12px] text-white/70 mt-1.5">{left ? `${left} more to go. Keep going!` : "Target reached. Brilliant work!"}</div></div>
      <div className="relative flex items-center gap-3">
        <span aria-hidden className="hr-bob size-14 rounded-2xl bg-white/15 border border-white/20 flex items-center justify-center text-[26px] max-[560px]:hidden">{pct >= 100 ? "🏆" : "🎯"}</span>
        <div className="text-right"><div className="text-[40px] font-bold leading-none"><CountUp value={pct} format={(n) => `${n}%`} /></div><div className="text-[11px] text-white/70">of monthly target</div></div>
      </div>
    </div>
    <Grid n={4}><Stat l="Assigned to me" v={d.leads.length} sub={`${fresh.length} new`} /><Stat l="In pipeline" v={d.leads.filter((l) => !["won", "lost", "new"].includes(l.stage)).length} c="#0f172a" /><Stat l="Follow-ups due" v={due.length} c={due.length ? "#B45309" : "#0f172a"} /><Stat l="Incentive earned" v={inr(d.incentive)} sub={`${d.pct}% of ${inr(d.value)} annual plan value`} /></Grid>
    <Grid n={2}>
      <Card title="Follow-ups today" pad>{due.length ? due.slice(0, 8).map((l) => <div key={l.id} className="py-2.5 border-t border-[#F1F5F9] first:border-0"><div className="flex items-center gap-2 mb-1.5"><div className="flex-1"><strong className="text-[13.5px]">{l.name}</strong><div className="text-[12px] text-[#64748B]">{l.owner} · {l.city} · {l.phone}</div></div><Stage s={l.stage} /></div><LeadActions l={l} /></div>) : <Empty>No follow-ups due. Nice.</Empty>}</Card>
      <Card title={`Team leaderboard · ${new Date().toLocaleDateString("en-IN", { month: "long", timeZone: "Asia/Kolkata" })}`} pad>{d.team.map((t, i) => <div key={t.id} className="py-1.5"><div className="flex justify-between text-[13px]"><span>{i + 1}. {t.name}{t.id === sh.me.id ? " (you)" : ""}</span><strong>{t.won} / {t.target}</strong></div><div className="h-1.5 bg-[#E2E8F0] rounded-full mt-1"><div className="hr-fill h-full bg-[#14B8A6] rounded-full" style={{ width: `${t.target ? Math.min(100, (t.won * 100) / t.target) : 0}%`, animationDelay: `${400 + i * 90}ms` }} /></div></div>)}</Card>
    </Grid>
    <Card title="New leads from HR" right={<span className="text-[12px] text-[#64748B]">{fresh.length} waiting</span>}>
      <Table head={["Pharmacy", "Plan", "Source", ""]} empty={fresh.length ? undefined : "No new leads. HR assigns them here."}>{fresh.slice(0, 8).map((l) => <tr key={l.id}><td className={tdCls}><strong>{l.name}</strong><div className="text-[12px] text-[#64748B]">{l.owner} · {l.city}</div></td><td className={tdCls}>{l.plan} · {inr(l.planPrice)}/mo</td><td className={tdCls}>{l.source}</td><td className={tdCls}><button className={primaryCls} onClick={() => run(() => setLeadStage(l.id, "contacted"))}>Mark contacted</button></td></tr>)}</Table></Card>
  </>;
}

export function LeadBoard({ d }: { d: Data<"slboard"> }) {
  const { run } = useRun();
  const [list, setList] = useState(false);
  const cols = STAGES.map((s) => ({ ...s, leads: d.leads.filter((l) => l.stage === s.id) }));
  const idx = (id: string) => STAGES.findIndex((s) => s.id === id);
  return <>
    <div className="flex items-center gap-3 flex-wrap"><span className="text-[13px] text-[#64748B]"><strong>{d.wonMonth} won</strong> · {Math.max(0, d.target - d.wonMonth)} to go for the month’s target of {d.target}</span><button className={cx(btnCls, "ml-auto")} onClick={() => setList(!list)}>{list ? "Board view" : "List view"}</button></div>
    {list ? <Card><Table head={["Pharmacy", "Stage", "Follow-up", ""]}>{d.leads.map((l) => <tr key={l.id}><td className={tdCls}><strong>{l.name}</strong><div className="text-[12px] text-[#64748B]">{l.city}</div></td><td className={tdCls}><Stage s={l.stage} /></td><td className={tdCls}>{l.follow || "—"}</td><td className={tdCls}><LeadActions l={l} /></td></tr>)}</Table></Card> :
      <div className="grid gap-3 overflow-x-auto pb-2" style={{ gridTemplateColumns: "repeat(6,minmax(210px,1fr))" }}>
        {cols.map((c) => <div key={c.id} className="bg-[#EEF2F6] rounded-xl p-2.5 flex flex-col gap-2 min-h-[120px]"><div className="text-[12px] font-bold px-1 flex justify-between" style={{ color: c.fg }}><span>● {c.label}</span><span>{c.leads.length}</span></div>
          {c.leads.slice(0, c.id === "won" ? 6 : 50).map((l) => <div key={l.id} className="bg-white rounded-lg border border-[#E2E8F0] p-2.5 text-[12.5px]"><div className="font-semibold">{l.name}</div><div className="text-[11.5px] text-[#64748B]">{l.owner} · {l.city}</div><div className="flex gap-1 mt-1 flex-wrap"><Pill tone="gray">{l.plan}</Pill>{l.follow ? <Pill tone={l.follow === "Overdue" || l.follow === "Today" ? "amber" : "gray"}>{l.follow}</Pill> : null}</div>
            {c.id !== "won" && c.id !== "lost" ? <div className="flex gap-1 mt-2"><button className={btnCls} aria-label="Back a stage" disabled={idx(c.id) === 0} onClick={() => run(() => setLeadStage(l.id, STAGES[idx(c.id) - 1].id))}>‹</button><button className={cx(primaryCls, "!py-1 !px-2.5 !text-[12px] flex-1 justify-center")} onClick={() => run(() => setLeadStage(l.id, STAGES[idx(c.id) + 1].id), () => (STAGES[idx(c.id) + 1].id === "won" ? `${l.name} won. The sale is logged.` : ""))}>{STAGES[idx(c.id) + 1].label} ›</button></div> : null}</div>)}
          {c.id === "won" && c.leads.length > 6 ? <div className="text-[11.5px] text-[#64748B] text-center">+{c.leads.length - 6} more won</div> : null}</div>)}
      </div>}
  </>;
}

export function MyLeads({ d }: { d: Data<"slleads"> }) {
  const [q, setQ] = useState(""), [f, setF] = useState("all");
  const list = d.leads.filter((l) => (f === "all" || l.stage === f) && `${l.name} ${l.owner} ${l.city} ${l.code} ${l.phone}`.toLowerCase().includes(q.toLowerCase()));
  return <>
    <div className="flex gap-2 flex-wrap items-center"><input className={cx(inputCls, "!w-72")} placeholder="Search pharmacy, owner, city or lead ID" value={q} onChange={(e) => setQ(e.target.value)} /><Tabs value={f} onChange={setF} options={[["all", `All · ${d.leads.length}`], ...STAGES.map((s) => [s.id, `${s.label} · ${d.leads.filter((l) => l.stage === s.id).length}`] as [string, string])]} /></div>
    <Card><Table head={["Pharmacy", "City", "Phone", "Plan", "Stage", "Follow-up", "Actions"]} empty={list.length ? undefined : "No leads match."}>{list.map((l) => <tr key={l.id}><td className={tdCls}><strong>{l.name}</strong><div className="text-[11.5px] text-[#94A3B8]">{l.code} · {l.owner}</div></td><td className={tdCls}>{l.city}</td><td className={tdCls}>+91 {l.phone}</td><td className={tdCls}>{l.plan}</td><td className={tdCls}><Stage s={l.stage} /></td><td className={tdCls}>{l.follow || "—"}</td><td className={tdCls}><LeadActions l={l} /></td></tr>)}</Table></Card>
  </>;
}

// ── HR: leads
/** The master lead list in Google Sheets: connect it once, then sync by hand or every day. */
function LeadSheetCard({ sheet }: { sheet: Data<"hrleads">["sheet"] }) {
  const { run, busy } = useRun();
  const [v, setV] = useState({ url: sheet.url, auto: sheet.auto, assign: sheet.assign }), [skipped, setSkipped] = useState<string[]>([]);
  const last = sheet.last, dirty = v.url !== sheet.url || v.auto !== sheet.auto || v.assign !== sheet.assign;
  return (
    <Card title="Master lead sheet · Google Sheets" sub="Connect your Google Sheet of leads. New rows are added and given to the sales team to call." pad>
      <div className="flex flex-col gap-3">
        <Field label="Google Sheet link" hint="Open the sheet ▸ Share ▸ General access ▸ “Anyone with the link” ▸ Viewer, then paste its address here. Use the tab you want (its link ends with #gid=…).">
          <input className={inputCls} placeholder="https://docs.google.com/spreadsheets/d/…" value={v.url} onChange={(e) => setV({ ...v, url: e.target.value })} />
        </Field>
        <div className="flex gap-5 flex-wrap text-[13px]">
          <label className="flex items-center gap-2"><input type="checkbox" checked={v.assign} onChange={(e) => setV({ ...v, assign: e.target.checked })} />Give new leads to the sales team automatically (fewest open leads first)</label>
          <label className="flex items-center gap-2"><input type="checkbox" checked={v.auto} disabled={!v.url} onChange={(e) => setV({ ...v, auto: e.target.checked })} />Sync every day</label>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          <button className={primaryCls} disabled={busy || !dirty} onClick={() => run(() => saveLeadSheet(v))}>Save</button>
          <button className={btnCls} disabled={busy || !sheet.url || dirty} onClick={() => run(() => syncLeadSheet(), (r) => { setSkipped(r.skippedRows); return `${r.added} new lead${r.added === 1 ? "" : "s"} added${r.assigned ? `, ${r.assigned} given to the sales team` : ""}.`; })}>↻ Sync now</button>
          {dirty ? <span className="text-[12px] text-[#B45309]">Save your changes, then sync.</span> : null}
        </div>
        {last ? <p role="status" className={cx("text-[12.5px] rounded-lg px-3 py-2", last.error ? "bg-[#FDECEA] text-[#B3261E]" : "bg-[#F0FDFA] text-[#0B5E5B]")}>
          {last.error ? `Last sync failed: ${last.error}` : `Last sync ${new Date(last.at).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit", timeZone: "Asia/Kolkata" })} by ${last.by}: ${last.added} added, ${last.assigned} given out, ${last.skipped} skipped (already leads or invalid rows).${last.unmatched ? ` ${last.unmatched} left waiting for a ${last.unmatchedLang.join(" / ") || "matching"}-speaking salesperson.` : ""}${last.more ? ` More rows are waiting. Press Sync now again (up to ${sheet.maxPerRun} new leads at a time).` : ""}`}
        </p> : null}
        {skipped.length ? <details className="text-[12px] text-[#64748B]"><summary className="cursor-pointer">Skipped rows</summary><ul className="list-disc pl-5 mt-1">{skipped.map((x) => <li key={x}>{x}</li>)}</ul></details> : null}
        <p className="text-[12px] text-[#64748B]">Columns (first row): <b>store</b>, <b>owner</b>, <b>phone</b>, <b>city</b>, <b>plan</b>, <b>source</b>. Optional: <b>state</b> (leads go to salespeople who speak that state’s language: a salesperson from Bihar gets Hindi-speaking states only; without a state column Medoro guesses from well-known towns) and <b>assigned to</b> with an employee ID or name to give that lead straight to one salesperson. Leads are matched by phone number, so the same sheet can be synced again and again.</p>
      </div>
    </Card>
  );
}

export function HrLeads({ d }: { d: Data<"hrleads"> }) {
  const { run, busy, toast } = useRun();
  const file = useRef<HTMLInputElement>(null);
  const [f, setF] = useState("all"), [q, setQ] = useState(""), [form, setForm] = useState({ name: "", owner: "", phone: "", city: "", plan: "starter", staffId: "" }), [terms, setTerms] = useState<{ id: string; name: string; target: string; pct: string } | null>(null), [res, setRes] = useState<{ added: number; skipped: string[]; skippedCount: number } | null>(null);
  const waiting = d.leads.filter((l) => !l.staffId && l.stage !== "won").length;
  const list = d.leads.filter((l) => (f === "all" || (f === "none" ? !l.staffId : l.staffId === f)) && `${l.name} ${l.owner} ${l.city} ${l.phone} ${l.code}`.toLowerCase().includes(q.toLowerCase())).slice(0, 150);
  const upload = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 2_000_000) return toast("That file is too large. Upload up to about 10,000 leads at a time.", "red");
    run(async () => importLeads(await file.text()), (r) => { setRes(r); return `${r.added} lead${r.added === 1 ? "" : "s"} added.`; });
  };
  return <>
    <LeadSheetCard sheet={d.sheet} />
    <Grid n={4}>{d.team.map((t) => <Card key={t.id} pad><div className="flex items-center gap-2.5"><Avatar name={t.name} size={32} /><div className="flex-1 min-w-0"><div className="font-semibold text-[13.5px] truncate">{t.name}</div><div className="text-[11.5px] text-[#64748B]">{t.empNo}</div></div><button className={btnCls} onClick={() => setTerms({ id: t.id, name: t.name, target: String(t.target), pct: String(t.pct) })}>Terms</button></div>
      <div className="text-[22px] font-bold mt-2">{t.won} / {t.target}</div><div className="h-1.5 bg-[#E2E8F0] rounded-full"><div className="hr-fill h-full bg-[#14B8A6] rounded-full" style={{ width: `${t.target ? Math.min(100, (t.won * 100) / t.target) : 0}%` }} /></div><div className="text-[11.5px] text-[#64748B] mt-1.5">{t.open} open · {t.assigned} assigned · incentive {inr(t.incentive)} at {t.pct}%</div></Card>)}{!d.team.length ? <Card pad><Empty>No sales employees yet. Create one in New Employee with access “Sales”.</Empty></Card> : null}</Grid>
    <Grid n={2}>
      <Card title="Upload leads" sub="CSV with columns: store, owner, phone, city, plan, source. Uploaded leads arrive unassigned." pad>
        <input ref={file} type="file" accept=".csv,text/csv" hidden onChange={(e) => { void upload(e.target.files?.[0]); e.target.value = ""; }} />
        <div className="flex gap-2 flex-wrap"><button className={primaryCls} disabled={busy} onClick={() => file.current?.click()}>Choose CSV file</button><button className={btnCls} onClick={() => { const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob(["store,owner,phone,city,plan,source\nSample Medical Hall,Rakesh Gupta,9876500000,Bokaro,Starter,Field visit\n"], { type: "text/csv" })); a.download = "leads-sample.csv"; a.click(); }}>Download sample</button></div>
        {res ? <div className="mt-3 text-[12.5px] bg-[#F8FAFC] rounded-lg p-3"><strong>{res.added} added</strong>{res.skippedCount ? `, ${res.skippedCount} skipped:` : "."}<ul className="list-disc pl-5 mt-1 text-[#64748B]">{res.skipped.map((s) => <li key={s}>{s}</li>)}</ul></div> : null}
        <div className="mt-3 flex items-center gap-2 bg-[#FFFBEB] border border-[#FDE68A] rounded-xl px-3 py-2 text-[13px]"><span className="flex-1">{waiting} lead{waiting === 1 ? "" : "s"} waiting for a salesperson</span><button className={primaryCls} disabled={busy || !waiting} onClick={() => run(() => autoAssignLeads(), (r) => `${r.given} lead${r.given === 1 ? "" : "s"} given out by language.${r.unmatched ? ` ${r.unmatched} left waiting${r.unmatchedLang.length ? ` for a ${r.unmatchedLang.join(" / ")}-speaking salesperson` : ""}.` : ""}`)}>Give out by language</button></div>
      </Card>
      <Card title="Add a single lead" pad><form className="flex flex-col gap-2" onSubmit={(e) => { e.preventDefault(); run(() => addLead({ ...form, plan: form.plan as "starter" }), (code) => { setForm({ ...form, name: "", owner: "", phone: "", city: "" }); return `Lead ${code} added.`; }); }}>
        <Grid n={3}><Field label="Pharmacy name"><input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></Field><Field label="Owner"><input className={inputCls} value={form.owner} onChange={(e) => setForm({ ...form, owner: e.target.value })} /></Field><Field label="Phone"><input className={inputCls} value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} required inputMode="tel" /></Field><Field label="City"><input className={inputCls} value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} /></Field>
          <Field label="Plan"><select className={inputCls} value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })}>{d.plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></Field><Field label="Assign to"><select className={inputCls} value={form.staffId} onChange={(e) => setForm({ ...form, staffId: e.target.value })}><option value="">Unassigned</option>{d.team.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></Field></Grid>
        <div><button className={primaryCls} disabled={busy}>Add lead</button></div></form></Card>
    </Grid>
    <div className="flex gap-2 flex-wrap items-center"><input className={cx(inputCls, "!w-64")} placeholder="Search leads…" value={q} onChange={(e) => setQ(e.target.value)} /><Tabs value={f} onChange={setF} options={[["all", `All · ${d.leads.length}`], ["none", `Unassigned · ${d.leads.filter((l) => !l.staffId).length}`], ...d.team.map((t) => [t.id, t.name.split(" ")[0]] as [string, string])]} /></div>
    <Card><Table head={["Lead", "Pharmacy", "City / state", "Plan", "Stage", "Assigned to"]} empty={list.length ? undefined : "No leads."}>{list.map((l) => <tr key={l.id}><td className={tdCls}>{l.code}</td><td className={tdCls}><strong>{l.name}</strong><div className="text-[11.5px] text-[#94A3B8]">{l.owner} · {l.phone}</div></td><td className={tdCls}>{l.city}{l.state ? <div className="text-[11.5px] text-[#64748B]">{l.state}</div> : null}</td><td className={tdCls}>{l.plan}</td><td className={tdCls}><Stage s={l.stage} /></td><td className={tdCls}><select aria-label={`Assign ${l.name}`} className="border border-[#CDD2D7] rounded-lg px-2 py-1.5 text-[12.5px] bg-white" disabled={l.stage === "won"} value={l.staffId} onChange={(e) => run(() => assignLead(l.id, e.target.value))}><option value="">Unassigned</option>{d.team.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}</select></td></tr>)}</Table>
      <div className="px-4 py-2 text-[12px] text-[#64748B]">Showing {list.length} of {d.leads.length}</div></Card>
    {terms ? <Modal title={`Target and incentive · ${terms.name}`} onClose={() => setTerms(null)}><form className="flex gap-3 items-end" onSubmit={(e) => { e.preventDefault(); run(() => setSalesTerms(terms.id, { target: Number(terms.target), pct: Number(terms.pct) }), () => { setTerms(null); }); }}><Field label="Monthly target"><input className={inputCls} inputMode="numeric" value={terms.target} onChange={(e) => setTerms({ ...terms, target: e.target.value })} /></Field><Field label="Incentive % (max 5)"><input className={inputCls} inputMode="decimal" value={terms.pct} onChange={(e) => setTerms({ ...terms, pct: e.target.value })} /></Field><button className={primaryCls}>Save</button></form></Modal> : null}
  </>;
}
