"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Copy, Sparkles } from "lucide-react";
import { aiDemoPrep, aiDraft, aiResearch } from "../../../growth-actions";
import { Empty, Panel, Tabs, btn, btnPrimary, fieldCls, selSm, useRun } from "../../ui";
import { Prov, ScoreBreakdown, StageBadge } from "../kit";

type R = Extract<Awaited<ReturnType<typeof aiResearch>>, { ok: true }>["data"];
type P = Extract<Awaited<ReturnType<typeof aiDemoPrep>>, { ok: true }>["data"];
type O = { key: string; label: string; en: string; hi: string; hinglish: string };

export function AiView({ leadId, q, leads, objections }: { leadId: string | null; q: string; leads: { id: string; name: string; city: string }[]; objections: O[] }) {
  const router = useRouter();
  const { run, busy } = useRun();
  const [r, setR] = useState<R | null>(null);
  const [prep, setPrep] = useState<P | null>(null);
  const [tab, setTab] = useState<"research" | "draft" | "objections" | "demo">("research");
  const [d, setD] = useState({ lang: "en", purpose: "intro", channel: "whatsapp", polish: false });
  const [draft, setDraft] = useState<{ text: string; subject: string; source: string; notes: string[] } | null>(null);
  const [lang, setLang] = useState<"en" | "hi" | "hinglish">("en");
  useEffect(() => { if (leadId) run(() => aiResearch(leadId), (x) => { setR(x); setPrep(null); setDraft(null); }); }, [leadId, run]);
  return (
    <div className="grid gap-4 min-[1100px]:grid-cols-[300px_minmax(0,1fr)]">
      <Panel title="Choose a lead">
        <form className="flex gap-2 p-3" onSubmit={(e) => { e.preventDefault(); router.push(`?q=${encodeURIComponent((e.currentTarget.elements.namedItem("q") as HTMLInputElement).value)}`); }}><input name="q" defaultValue={q} className={fieldCls} placeholder="Search your leads" /><button className={btn}>Go</button></form>
        {leads.map((l) => <Link key={l.id} href={`?lead=${l.id}${q ? `&q=${encodeURIComponent(q)}` : ""}`} className={`block px-4 py-2 border-t border-[#F1F3F4] text-[13px] ${l.id === leadId ? "bg-teal-tint font-semibold" : "hover:bg-[#FAFBFB]"}`}>{l.name}<span className="text-muted"> · {l.city}</span></Link>)}
        {!leads.length ? <Empty>No leads.</Empty> : null}
      </Panel>
      <div className="flex flex-col gap-4 min-w-0">
        <div className="text-[12.5px] text-muted bg-white border border-[#E6E8EB] rounded-xl px-4 py-3">Labels: <Prov p="verified" /> checked with evidence · <Prov p="user_provided" /> told to an employee · <Prov p="source" /> as listed · <Prov p="inferred" /> a rule’s guess, never scored · <Prov p="unknown" /> not known. Medoro never invents owners, revenue, current software or intent.</div>
        {!r ? <Panel><Empty>{busy ? "Reading the lead…" : "Pick a lead to see its brief."}</Empty></Panel> : (<>
          <div className="flex gap-2 items-center flex-wrap"><strong className="text-[17px]">{r.lead.name}</strong><StageBadge s={r.lead.stage} /><span className="text-[13px] font-semibold">Qualification: {r.qualification}</span><Link href={`/staff/growth/leads/${r.lead.id}`} className={btn + " ml-auto"}>Open lead</Link></div>
          <Tabs value={tab} options={[["research", "Research & score"], ["draft", "Message drafts"], ["objections", "Objections"], ["demo", "Demo prep"]]} onChange={(v) => { setTab(v); if (v === "demo" && !prep) run(() => aiDemoPrep(r.lead.id), setPrep); }} />
          {tab === "research" ? (
            <div className="grid gap-4 min-[1200px]:grid-cols-2">
              <Panel title="What we know">{[...r.facts, ...r.inferred].map((f) => <div key={f.label + f.value} className="px-4 py-2 border-t border-[#F1F3F4] text-[13px] flex gap-2"><span className="text-muted w-[150px] flex-none">{f.label}</span><span className="flex-1">{f.value}{f.evidence ? <span className="text-muted"> · {f.evidence}</span> : null}</span><Prov p={f.provenance} /></div>)}</Panel>
              <div className="flex flex-col gap-4">
                <Panel title="Score"><ScoreBreakdown lines={r.score.lines} total={r.score.total} /></Panel>
                <Panel title="Sales opportunity" sub={r.opportunities.note}><ul className="list-disc pl-8 pr-4 py-3 text-[13px]">{r.opportunities.list.map((o) => <li key={o}>{o}</li>)}</ul></Panel>
                <Panel title="Recommended next step"><div className="p-4 text-[13.5px]"><strong>{r.followUp.action}</strong>{r.followUp.when ? ` — ${r.followUp.when}` : ""}<div className="text-muted">{r.followUp.why}</div></div></Panel>
              </div>
            </div>
          ) : tab === "draft" ? (
            <Panel title="Draft a message" sub="Filled only with recorded facts. You review it; nothing is sent from here.">
              <div className="flex gap-2 p-4 flex-wrap">
                <select className={selSm} value={d.lang} onChange={(e) => setD({ ...d, lang: e.target.value })}><option value="en">English</option><option value="hi">हिंदी</option><option value="hinglish">Hinglish</option></select>
                <select className={selSm} value={d.purpose} onChange={(e) => setD({ ...d, purpose: e.target.value })}><option value="intro">Introduction</option><option value="followup">Follow-up</option><option value="demo_confirm">Demo confirmation</option><option value="after_demo">After the demo</option><option value="call_script">Call script</option></select>
                <select className={selSm} value={d.channel} onChange={(e) => setD({ ...d, channel: e.target.value })}><option value="whatsapp">WhatsApp</option><option value="email">Email</option><option value="call">Call</option></select>
                <label className="flex gap-1.5 items-center text-[13px]"><input type="checkbox" checked={d.polish} onChange={(e) => setD({ ...d, polish: e.target.checked })} />Reword with the AI model (if configured)</label>
                <button className={btnPrimary} disabled={busy} onClick={() => run(() => aiDraft({ leadId: r.lead.id, ...d } as never), setDraft)}><Sparkles size={15} />Draft</button>
              </div>
              {draft ? <div className="px-4 pb-4 flex flex-col gap-2">{draft.subject ? <div className="text-[13px]"><span className="text-muted">Subject:</span> {draft.subject}</div> : null}<textarea className={fieldCls + " min-h-[160px]"} defaultValue={draft.text} key={draft.text} /><div className="text-[12px] text-muted">{draft.notes.join(" ")}</div><button className={btn + " self-start"} onClick={() => navigator.clipboard.writeText(draft.text)}><Copy size={14} />Copy</button></div> : null}
            </Panel>
          ) : tab === "objections" ? (
            <Panel title="Objection handling" sub="Medoro’s own talking points" right={<select className={selSm} value={lang} onChange={(e) => setLang(e.target.value as "en")}><option value="en">English</option><option value="hi">हिंदी</option><option value="hinglish">Hinglish</option></select>}>
              {objections.map((o) => <div key={o.key} className="px-4 py-3 border-t border-[#F1F3F4] text-[13.5px]"><strong>“{o.label}”</strong><div>{o[lang]}</div></div>)}
            </Panel>
          ) : (
            <Panel title="Demo preparation">{prep ? (
              <div className="p-4 flex flex-col gap-3 text-[13.5px]">
                <div><strong>Agenda (about 20 minutes)</strong><ol className="list-decimal pl-6">{prep.agenda.map((x) => <li key={x}>{x}</li>)}</ol></div>
                <div><strong>Objections heard on earlier calls</strong>{prep.objectionsHeard.length ? prep.objectionsHeard.map((o) => <div key={o.key} className="mt-1"><em>{o.label}:</em> {o.answer}</div>) : <div className="text-muted">None recorded.</div>}</div>
                <div><strong>Recent calls</strong>{prep.recentCalls.length ? prep.recentCalls.map((c, i) => <div key={i} className="text-[13px]">{c.outcome?.replace(/_/g, " ").toLowerCase()} · {c.notes}</div>) : <div className="text-muted">No calls yet.</div>}</div>
              </div>
            ) : <Empty>Loading…</Empty>}</Panel>
          )}
        </>)}
      </div>
    </div>
  );
}
