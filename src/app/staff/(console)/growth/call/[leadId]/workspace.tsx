"use client";
import { useState } from "react";
import Link from "next/link";
import { MapPin } from "lucide-react";
import { outcomeLabel } from "@/staff/growth/constants";
import { Empty, Panel, btn } from "../../../ui";
import { CallButton, CallReportForm, StageBadge, VerifyBadge, fmtD, fmtDT } from "../../kit";

type L = { id: string; code: string; name: string; phone: string | null; phoneRaw: string; owner: string; address: string; city: string; district: string; state: string; pin: string; stage: string; verification: string; source: string; nextFollowUpAt: string | null; assignedAt: string | null; dueAt: string | null };

export function Workspace({ lead, mine, openSession, calls, recommendation }: { lead: L; mine: boolean; openSession: string | null; calls: { id: string; at: string; by: string; outcome: string | null; notes: string }[]; recommendation: { action: string; when: string | null; why: string } }) {
  const [session, setSession] = useState(openSession);
  const [done, setDone] = useState(false);
  return (
    <div className="grid gap-4 min-[1000px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <section className="bg-white border border-[#E6E8EB] rounded-xl p-5 flex flex-col gap-3 min-w-0">
        <span className="text-[12px] text-muted">{lead.code} · source: {lead.source || "—"}</span>
        <h1 className="text-[24px] font-bold leading-tight">{lead.name}</h1>
        <div className="flex gap-2 flex-wrap"><StageBadge s={lead.stage} /><VerifyBadge v={lead.verification} /></div>
        <dl className="grid grid-cols-[130px_1fr] gap-y-1.5 text-[14px]">
          <dt className="text-muted">Owner</dt><dd>{lead.owner || <span className="text-muted">Not verified</span>}</dd>
          <dt className="text-muted">Address</dt><dd className="flex gap-1"><MapPin size={14} className="mt-1 flex-none text-muted" />{[lead.address, lead.city].filter(Boolean).join(", ") || "—"}</dd>
          <dt className="text-muted">District / State</dt><dd>{[lead.district, lead.state].filter(Boolean).join(", ") || "—"}</dd>
          <dt className="text-muted">PIN code</dt><dd>{lead.pin || "—"}</dd>
          <dt className="text-muted">Assigned</dt><dd>{fmtD(lead.assignedAt)}{lead.dueAt ? ` · deadline ${fmtD(lead.dueAt)}` : ""}</dd>
          <dt className="text-muted">Next follow-up</dt><dd>{fmtDT(lead.nextFollowUpAt)}</dd>
        </dl>
        {mine ? (
          lead.stage === "DO_NOT_CONTACT" ? <p className="text-[#C0362C] text-[14px]">This pharmacy asked not to be contacted.</p>
            : <div className="pt-2"><CallButton leadId={lead.id} phone={lead.phone} onSession={(s) => { setSession(s.callSessionId); setDone(false); }} /></div>
        ) : <p className="text-muted text-[13.5px]">Only the employee this lead is assigned to can call it from here.</p>}
        {!lead.phone ? <p className="text-[13px] text-[#94570A]">No valid number{lead.phoneRaw ? ` (listed as “${lead.phoneRaw}”)` : ""}. Ask a manager to fix it in Lead verification.</p> : null}
        <div className="text-[12.5px] text-muted border-t border-[#EEF0F2] pt-2">Suggested next step: <strong className="text-ink">{recommendation.action}</strong>{recommendation.when ? ` (${recommendation.when})` : ""} — {recommendation.why}</div>
        <div className="flex gap-2"><Link href={`/staff/growth/leads/${lead.id}`} className={btn}>Full lead</Link><Link href={`/staff/growth/ai?lead=${lead.id}`} className={btn}>Call script & objections</Link><Link href="/staff/growth/call" className={btn}>Back to queue</Link></div>
      </section>
      <div className="flex flex-col gap-4 min-w-0">
        {session && !done ? <Panel title="Call report" sub="Fill this in as soon as you hang up"><CallReportForm sessionId={session} onDone={() => setDone(true)} /></Panel>
          : done ? <Panel title="Report saved"><div className="p-4 flex gap-2"><Link href="/staff/growth/call" className={btn}>Next lead</Link></div></Panel> : null}
        <Panel title="Previous call reports">
          {calls.length ? calls.map((c) => <div key={c.id} className="px-4 py-2.5 border-t border-[#F1F3F4] text-[13px]"><span className="text-muted">{fmtDT(c.at)} · {c.by}</span> · <strong>{c.outcome ? outcomeLabel(c.outcome) : "Dialer opened, not reported"}</strong><div>{c.notes}</div></div>) : <Empty>No calls yet.</Empty>}
        </Panel>
      </div>
    </div>
  );
}
