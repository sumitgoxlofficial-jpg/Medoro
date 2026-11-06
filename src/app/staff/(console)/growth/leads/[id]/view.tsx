"use client";
import { useState } from "react";
import Link from "next/link";
import { ExternalLink, Sparkles } from "lucide-react";
import { CATEGORIES, CHANNELS, INDIAN_STATES, LOST_REASONS, STAGES, categoryLabel, outcomeLabel } from "@/staff/growth/constants";
import { displayPhone } from "@/staff/growth/normalize";
import * as act from "../../../../growth-actions";
import { Empty, Panel, Pill, btn, btnPrimary, fieldCls, lbl, selSm, td, th, useRun } from "../../../ui";
import { CallButton, CallReportForm, Prov, ScoreBreakdown, StageBadge, VerifyBadge, fmtD, fmtDT, localToIso } from "../../kit";

type D = Awaited<ReturnType<typeof import("@/staff/growth/leads").leadDetail>>;
// Dates arrive as strings from the server component.
type S<T> = T extends Date ? string : T extends (infer U)[] ? S<U>[] : T extends object ? { [K in keyof T]: S<T[K]> } : T;

const METHODS: Record<string, [string, string][]> = {
  business: [["document", "Drug licence / GST number checked"], ["field_visit", "Field visit"], ["call_confirmed", "Owner confirmed on a call"], ["manual_review", "Official record reviewed"]],
  phone: [["call_confirmed", "Called; the pharmacy answered"]],
  email: [["email_reply", "Reply received from this address"], ["manual_review", "Published on the pharmacy’s own site"]],
  website: [["manual_review", "Opened and checked by hand"]],
  location: [["field_visit", "Field visit"], ["call_confirmed", "Address confirmed on a call"], ["manual_review", "Map / official record reviewed"]],
};

export function LeadDetailView({ d, me, openSession, templates, can }: { d: S<D>; me: string; openSession: string | null; templates: { id: string; channel: string; name: string; language: string }[]; can: Record<string, boolean> }) {
  const { run, busy } = useRun();
  const l = d.lead;
  const [session, setSession] = useState<string | null>(openSession);
  const mine = l.assignedStaffId === me;
  const [stage, setStage] = useState(l.stage);
  const [lost, setLost] = useState("");
  const [note, setNote] = useState("");

  return (
    <>
      <section className="bg-white border border-[#E6E8EB] rounded-xl p-4 flex flex-col gap-3">
        <div className="flex gap-3 items-start flex-wrap">
          <div className="flex flex-col gap-1 min-w-0 flex-1">
            <span className="text-[12px] text-muted">{l.code} · {categoryLabel(l.category)}{d.source ? ` · ${d.source.name}` : ""}</span>
            <h1 className="text-[22px] font-bold leading-tight">{l.name}</h1>
            <div className="flex gap-2 flex-wrap items-center"><StageBadge s={l.stage} /><VerifyBadge v={l.verification} /><Pill bg="#EAF0FC" fg="#0B3A78">Score {l.score}</Pill>{l.erasedAt ? <Pill bg="#FBEAE9" fg="#C0362C">Erased</Pill> : null}{d.suppression.phone ? <Pill bg="#FBEAE9" fg="#C0362C">Do not call</Pill> : null}</div>
            <span className="text-[13px] text-muted">Assigned to {d.assignee || "nobody"}{l.lastContactedAt ? ` · last contacted ${fmtD(l.lastContactedAt)}` : ""}{l.nextFollowUpAt ? ` · next follow-up ${fmtDT(l.nextFollowUpAt)}` : ""}</span>
          </div>
          <div className="flex gap-2 flex-wrap">
            {can.call && mine && !l.erasedAt ? <CallButton leadId={l.id} phone={l.phone} onSession={(s) => setSession(s.callSessionId)} /> : null}
            {can.ai ? <Link href={`/staff/growth/ai?lead=${l.id}`} className={btn}><Sparkles size={14} />AI brief</Link> : null}
          </div>
        </div>
        {session ? (
          <div className="border border-teal-border rounded-lg bg-teal-soft">
            <div className="px-4 pt-3 text-[13.5px] font-semibold">After the call: report what happened</div>
            <CallReportForm sessionId={session} onDone={() => setSession(null)} />
          </div>
        ) : null}
      </section>

      <div className="grid gap-4 min-[1100px]:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4 min-w-0">
          <Panel title="Pharmacy facts" sub="Each fact shows where it comes from">
            <div className="grid gap-x-4 gap-y-2.5 p-4 grid-cols-[150px_1fr] text-[13.5px] max-[560px]:grid-cols-1">
              <span className="text-muted">Owner / contact</span><span>{l.ownerName || "Not known"} {l.ownerName ? <Prov p={l.ownerVerified ? "verified" : "source"} /> : <Prov p="unknown" />}</span>
              <span className="text-muted">Phone</span><span className="tnum">{l.phone ? displayPhone(l.phone) : l.phoneRaw || "—"} <Prov p={l.phoneVerifiedAt ? "verified" : l.phone ? "source" : "unknown"} /></span>
              <span className="text-muted">Email</span><span>{l.email || "—"} {l.email ? <Prov p={l.emailVerifiedAt ? "verified" : "source"} /> : null}</span>
              <span className="text-muted">Website</span><span>{l.website ? <a className="text-teal inline-flex gap-1 items-center" href={l.website} target="_blank" rel="noopener noreferrer nofollow">{l.website}<ExternalLink size={12} /></a> : "—"} {l.website ? <Prov p={l.websiteVerifiedAt ? "verified" : "source"} /> : null}</span>
              <span className="text-muted">Address</span><span>{[l.address, l.city, l.district, l.state, l.pin].filter(Boolean).join(", ") || "—"} <Prov p={l.locationVerifiedAt ? "verified" : l.address || l.pin ? "source" : "unknown"} /></span>
              <span className="text-muted">Billing today</span><span>{l.softwareStatus ? l.softwareStatus.replace(/_/g, " ") : "Not asked"} <Prov p={l.softwareStatus ? "user_provided" : "unknown"} /></span>
              <span className="text-muted">Source</span><span>{d.source?.name ?? "—"}{l.sourceUrl ? <> · <a className="text-teal" href={l.sourceUrl} target="_blank" rel="noopener noreferrer nofollow">source record</a></> : null}{d.source?.attribution ? <span className="text-muted"> · {d.source.attribution}</span> : null} · collected {fmtD(l.collectedAt)}</span>
            </div>
            {can.edit && !l.erasedAt ? <EditLead l={l} /> : null}
          </Panel>

          <Panel title="Calls" sub="Reports by employees; a dialer open without a report isn’t a call">
            {d.calls.length ? (
              <div className="overflow-auto"><table className="w-full border-collapse min-w-[640px] text-[13px]">
                <thead><tr className="bg-[#FAFBFB] text-muted text-[12px]"><th className={th}>When</th><th className={th}>By</th><th className={th}>Outcome</th><th className={th}>Interest</th><th className={th}>Notes</th></tr></thead>
                <tbody>{d.calls.map((c) => <tr key={c.id}><td className={td + " whitespace-nowrap"}>{fmtDT(c.reportedAt ?? c.launchedAt)}</td><td className={td}>{c.staffName}</td><td className={td}>{c.outcome ? outcomeLabel(c.outcome) : <span className="text-muted">Dialer opened, not reported</span>}</td><td className={td}>{c.interestLevel ?? ""}</td><td className={td}>{c.notes}</td></tr>)}</tbody>
              </table></div>
            ) : <Empty>No calls yet.</Empty>}
          </Panel>

          <Panel title="Notes">
            <form className="flex gap-2 p-4" onSubmit={(e) => { e.preventDefault(); run(() => act.addNote(l.id, note), () => { setNote(""); }); }}>
              <input className={fieldCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Add a note for the team" /><button className={btnPrimary} disabled={busy || !note.trim()}>Add</button>
            </form>
            {d.notes.map((n) => <div key={n.id} className="px-4 py-2.5 border-t border-[#F1F3F4] text-[13.5px]"><span className="text-muted text-[12px]">{n.staffName} · {fmtDT(n.at)}</span><div className="whitespace-pre-wrap">{n.text}</div></div>)}
          </Panel>

          <Panel title="Timeline" sub="Append-only record of everything that happened">
            <ol className="flex flex-col">{d.activities.map((x) => <li key={x.id} className="px-4 py-2 border-t border-[#F1F3F4] text-[13px] flex gap-3"><span className="text-muted whitespace-nowrap w-[120px] flex-none">{fmtDT(x.at)}</span><span>{x.text}{x.staffName ? <span className="text-muted"> · {x.staffName}</span> : null}</span></li>)}</ol>
          </Panel>
        </div>

        <div className="flex flex-col gap-4 min-w-0">
          <Panel title="Lead score" sub="Points only for recorded evidence"><ScoreBreakdown lines={d.score.lines} total={d.score.total} /></Panel>

          {can.edit && !l.erasedAt ? (
            <Panel title="Pipeline stage">
              <div className="flex gap-2 p-4 flex-wrap items-end">
                <select className={selSm} value={stage} onChange={(e) => setStage(e.target.value as typeof stage)}>{STAGES.filter(([v]) => v !== "CONVERTED").map(([v, lb]) => <option key={v} value={v}>{lb}</option>)}</select>
                {stage === "LOST" ? <select className={selSm} value={lost} onChange={(e) => setLost(e.target.value)}><option value="">Why lost?</option>{LOST_REASONS.map((r) => <option key={r}>{r}</option>)}</select> : null}
                <button className={btn} disabled={busy || stage === l.stage} onClick={() => run(() => act.setStage(l.id, { stage, lostReason: (lost || undefined) as never }))}>Move</button>
                {!["TRIAL_STARTED", "CONVERTED", "DO_NOT_CONTACT"].includes(l.stage) ? <button className={btn} disabled={busy} onClick={() => run(() => act.startTrial(l.id))}>Start trial</button> : null}
              </div>
              <DemoAndConversion d={d} />
            </Panel>
          ) : null}

          <FollowUps d={d} canEdit={can.call || can.edit} />
          {can.verify && !l.erasedAt ? <Verify d={d} /> : null}
          {can.consent && !l.erasedAt ? <Consent d={d} /> : null}
          {can.send && !l.erasedAt ? <Message leadId={l.id} templates={templates} /> : null}

          <Panel title="Assignment history">
            {d.assignments.length ? d.assignments.map((x) => <div key={x.id} className="px-4 py-2 border-t border-[#F1F3F4] text-[13px]"><strong>{x.staffName}</strong> {x.active ? <Pill bg="#E3F5EC" fg="#18794E">Active</Pill> : <span className="text-muted">until {fmtD(x.endedAt)}{x.endReason ? ` (${x.endReason})` : ""}</span>}<div className="text-muted text-[12px]">From {fmtD(x.assignedAt)} by {x.byName}{x.dueAt ? ` · deadline ${fmtD(x.dueAt)}` : ""}</div></div>) : <Empty>Never assigned.</Empty>}
          </Panel>

          {d.duplicates.length ? <Panel title="Possible duplicates"><div className="p-4 text-[13px] flex flex-col gap-1">{d.duplicates.map((x) => <span key={x.id}>{x.other ? <Link className="text-teal" href={`/staff/growth/leads/${x.other.id}`}>{x.other.code} · {x.other.name}</Link> : "Hidden lead"} — {x.reason}</span>)}<Link href="/staff/growth/verification" className="text-teal font-semibold mt-1">Review in Lead verification →</Link></div></Panel> : null}
          {can.erase && !l.erasedAt ? <Panel title="Data protection"><div className="p-4 flex gap-2 flex-wrap"><button className={btn} disabled={busy} onClick={() => { const why = window.prompt("Erase this pharmacy’s personal data? Give the reason (e.g. request received by email on …). This can’t be undone."); if (why) run(() => act.eraseLead(l.id, why)); }}>Erase personal data…</button></div></Panel> : null}
        </div>
      </div>
    </>
  );
}

function EditLead({ l }: { l: S<D>["lead"] }) {
  const { run, busy } = useRun();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ name: l.name, category: l.category as string, ownerName: l.ownerName, phone: l.phone ?? l.phoneRaw, email: l.email, website: l.website, address: l.address, city: l.city, district: l.district, state: l.state, pin: l.pin });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  if (!open) return <div className="px-4 pb-4"><button className={btn} onClick={() => setOpen(true)}>Edit details</button></div>;
  return (
    <form className="grid gap-2.5 p-4 border-t border-[#EEF0F2] grid-cols-2" onSubmit={(e) => { e.preventDefault(); run(() => act.updateLead(l.id, { ...f, updatedAt: l.updatedAt }), () => setOpen(false)); }}>
      <label className={lbl + " col-span-2"}>Name<input className={fieldCls} value={f.name} onChange={set("name")} /></label>
      <label className={lbl}>Category<select className={fieldCls} value={f.category} onChange={set("category")}>{CATEGORIES.map(([v, x]) => <option key={v} value={v}>{x}</option>)}</select></label>
      <label className={lbl}>Owner / contact<input className={fieldCls} value={f.ownerName} onChange={set("ownerName")} /></label>
      <label className={lbl}>Phone<input className={fieldCls} value={f.phone} onChange={set("phone")} /></label>
      <label className={lbl}>Email<input className={fieldCls} value={f.email} onChange={set("email")} /></label>
      <label className={lbl}>Website<input className={fieldCls} value={f.website} onChange={set("website")} /></label>
      <label className={lbl}>Address<input className={fieldCls} value={f.address} onChange={set("address")} /></label>
      <label className={lbl}>City<input className={fieldCls} value={f.city} onChange={set("city")} /></label>
      <label className={lbl}>District<input className={fieldCls} value={f.district} onChange={set("district")} /></label>
      <label className={lbl}>State<select className={fieldCls} value={f.state} onChange={set("state")}><option value="">—</option>{INDIAN_STATES.map((s) => <option key={s}>{s}</option>)}</select></label>
      <label className={lbl}>PIN<input className={fieldCls} value={f.pin} onChange={set("pin")} /></label>
      <p className="col-span-2 text-[12px] text-muted">Changing the phone, email, website or address withdraws its verification.</p>
      <div className="col-span-2 flex gap-2"><button className={btnPrimary} disabled={busy}>Save</button><button type="button" className={btn} onClick={() => setOpen(false)}>Cancel</button></div>
    </form>
  );
}

function Verify({ d }: { d: S<D> }) {
  const { run, busy } = useRun();
  const [kind, setKind] = useState("business");
  const [method, setMethod] = useState("document");
  const [detail, setDetail] = useState("");
  const [url, setUrl] = useState("");
  const l = d.lead;
  return (
    <Panel title="Verification" sub="Mark a fact verified only with evidence">
      <div className="grid grid-cols-5 gap-1 px-4 pt-3 text-[12px] text-center">
        {(["business", "phone", "email", "website", "location"] as const).map((k) => { const at = l[`${k}VerifiedAt` as "phoneVerifiedAt"]; return <span key={k} className={`rounded py-1 ${at ? "bg-[#E3F5EC] text-[#18794E] font-semibold" : "bg-[#F5F6F7] text-muted"}`}>{k}{at ? " ✓" : ""}</span>; })}
      </div>
      <form className="grid gap-2 p-4" onSubmit={(e) => { e.preventDefault(); run(() => act.verifyLead(l.id, { kind: kind as "business", method, detail, url }), () => { setDetail(""); setUrl(""); }); }}>
        <div className="flex gap-2"><select className={selSm} value={kind} onChange={(e) => { setKind(e.target.value); setMethod(METHODS[e.target.value][0][0]); }}>{Object.keys(METHODS).map((k) => <option key={k}>{k}</option>)}</select>
          <select className={selSm + " flex-1"} value={method} onChange={(e) => setMethod(e.target.value)}>{METHODS[kind].map(([v, x]) => <option key={v} value={v}>{x}</option>)}</select></div>
        <textarea className={fieldCls} rows={2} value={detail} onChange={(e) => setDetail(e.target.value)} placeholder="Evidence: what you checked and what it showed (e.g. licence number and where)" />
        <input className={fieldCls} value={url} onChange={(e) => setUrl(e.target.value)} placeholder="Link to the evidence (optional)" />
        <div className="flex gap-2 flex-wrap">
          <button className={btnPrimary} disabled={busy || detail.trim().length < 10}>Record verification</button>
          {l.website ? <button type="button" className={btn} disabled={busy} onClick={() => run(() => act.checkWebsite(l.id), (r) => r.detail)}>Check website now</button> : null}
          {l.invalidReason ? <button type="button" className={btn} disabled={busy} onClick={() => run(() => act.markInvalid(l.id, null))}>Clear invalid</button>
            : <button type="button" className={btn} disabled={busy} onClick={() => { const why = window.prompt("Why is this lead invalid? (e.g. shop closed, not a pharmacy)"); if (why) run(() => act.markInvalid(l.id, why)); }}>Mark invalid</button>}
        </div>
      </form>
      {d.evidence.slice(0, 8).map((e) => <div key={e.id} className="px-4 py-2 border-t border-[#F1F3F4] text-[12.5px]"><Pill bg={e.result === "verified" ? "#E3F5EC" : e.result === "failed" ? "#FBEAE9" : "#EEF0F2"} fg={e.result === "verified" ? "#18794E" : e.result === "failed" ? "#C0362C" : "#3D454D"}>{e.kind} · {e.result}</Pill> <span>{e.detail}</span> <span className="text-muted">· {fmtD(e.at)}</span></div>)}
    </Panel>
  );
}

function Consent({ d }: { d: S<D> }) {
  const { run, busy } = useRun();
  const [f, setF] = useState({ channel: "whatsapp", purpose: "marketing", lawfulBasis: "consent", evidence: "", source: "call" });
  return (
    <Panel title="Contact permission" sub="A public number alone doesn’t permit promotional messages">
      <form className="grid gap-2 p-4 grid-cols-2" onSubmit={(e) => { e.preventDefault(); run(() => act.recordConsent({ leadId: d.lead.id, ...f } as never), () => setF({ ...f, evidence: "" })); }}>
        <select className={selSm} value={f.channel} onChange={(e) => setF({ ...f, channel: e.target.value })}>{CHANNELS.map((c) => <option key={c}>{c}</option>)}</select>
        <select className={selSm} value={f.purpose} onChange={(e) => setF({ ...f, purpose: e.target.value })}><option value="marketing">Product information</option><option value="service">Service only</option></select>
        <select className={selSm} value={f.lawfulBasis} onChange={(e) => setF({ ...f, lawfulBasis: e.target.value })}><option value="consent">Consent</option><option value="legitimate_use">Legitimate use</option></select>
        <select className={selSm} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}><option value="call">On a call</option><option value="form">Web form</option><option value="inbound">They contacted us</option><option value="email">By email</option><option value="visit">In person</option></select>
        <input className={fieldCls + " col-span-2"} value={f.evidence} onChange={(e) => setF({ ...f, evidence: e.target.value })} placeholder="How it was given, in their words if possible" />
        <button className={btn + " col-span-2 justify-center"} disabled={busy || f.evidence.trim().length < 5}>Record permission</button>
      </form>
      {d.consents.map((c) => <div key={c.id} className="px-4 py-2 border-t border-[#F1F3F4] text-[12.5px] flex gap-2 items-start"><span className="flex-1"><strong>{c.channel}</strong> · {c.purpose} · {c.lawfulBasis} · {fmtD(c.grantedAt)}{c.revokedAt ? <span className="text-[#C0362C]"> · revoked {fmtD(c.revokedAt)}</span> : null}<div className="text-muted">{c.evidence}</div></span>{!c.revokedAt ? <button className={btn} disabled={busy} onClick={() => { const n = window.prompt("Why is this permission withdrawn?"); if (n) run(() => act.revokeConsent(c.id, n)); }}>Revoke</button> : null}</div>)}
    </Panel>
  );
}

function FollowUps({ d, canEdit }: { d: S<D>; canEdit: boolean }) {
  const { run, busy } = useRun();
  const [at, setAt] = useState("");
  const [note, setNote] = useState("");
  return (
    <Panel title="Follow-ups">
      {canEdit && d.lead.assignedStaffId && d.lead.stage !== "DO_NOT_CONTACT" ? (
        <form className="flex gap-2 p-4 flex-wrap" onSubmit={(e) => { e.preventDefault(); run(() => act.createFollowUp({ leadId: d.lead.id, dueAt: localToIso(at), note }), () => { setAt(""); setNote(""); }); }}>
          <input type="datetime-local" required className={selSm} value={at} onChange={(e) => setAt(e.target.value)} /><input className={selSm + " flex-1"} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What to do" /><button className={btn} disabled={busy}>Schedule</button>
        </form>
      ) : null}
      {d.followUps.length ? d.followUps.map((f) => (
        <div key={f.id} className="px-4 py-2 border-t border-[#F1F3F4] text-[13px] flex gap-2 items-center">
          <span className="flex-1">{fmtDT(f.dueAt)} · {d.names[f.staffId] ?? ""}{f.note ? <span className="text-muted"> · {f.note}</span> : null}</span>
          {f.status === "open" ? <button className={btn} disabled={busy} onClick={() => run(() => act.updateFollowUp(f.id, { action: "complete" }))}>Done</button> : <span className="text-muted">{f.status}</span>}
        </div>
      )) : <Empty>No follow-ups.</Empty>}
    </Panel>
  );
}

function DemoAndConversion({ d }: { d: S<D> }) {
  const { run, busy } = useRun();
  const [demo, setDemo] = useState({ at: "", mode: "phone" });
  const [conv, setConv] = useState({ product: "pro", cycle: "m", amountRupees: "", reference: "" });
  const l = d.lead;
  return (
    <div className="border-t border-[#EEF0F2] p-4 flex flex-col gap-3 text-[13px]">
      {d.demos.map((x) => <div key={x.id} className="flex gap-2 items-center"><span className="flex-1">Demo {fmtDT(x.at)} · {x.mode} · <strong>{x.status}</strong></span>{x.status === "scheduled" ? <><button className={btn} disabled={busy} onClick={() => run(() => act.updateDemo(x.id, "completed"))}>Completed</button><button className={btn} disabled={busy} onClick={() => run(() => act.updateDemo(x.id, "no_show"))}>No-show</button></> : null}</div>)}
      {!["CONVERTED", "DO_NOT_CONTACT"].includes(l.stage) ? (
        <form className="flex gap-2 flex-wrap" onSubmit={(e) => { e.preventDefault(); run(() => act.bookDemo({ leadId: l.id, at: localToIso(demo.at), mode: demo.mode as "phone" }), () => setDemo({ at: "", mode: "phone" })); }}>
          <input type="datetime-local" required className={selSm} value={demo.at} onChange={(e) => setDemo({ ...demo, at: e.target.value })} />
          <select className={selSm} value={demo.mode} onChange={(e) => setDemo({ ...demo, mode: e.target.value })}><option value="phone">Phone</option><option value="video">Video</option><option value="visit">Visit</option></select>
          <button className={btn} disabled={busy}>Book demo</button>
        </form>
      ) : null}
      {d.conversion ? <div className="text-[#18794E] font-semibold">Converted {fmtD(d.conversion.at)} · {d.conversion.product} · ₹{(d.conversion.amountPaise / 100).toLocaleString("en-IN")}</div> : l.stage !== "DO_NOT_CONTACT" ? (
        <form className="flex gap-2 flex-wrap" onSubmit={(e) => { e.preventDefault(); run(() => act.convertLead(l.id, conv as never)); }}>
          <select className={selSm} value={conv.product} onChange={(e) => setConv({ ...conv, product: e.target.value })}><option value="starter">Starter</option><option value="pro">Professional</option><option value="multi">Multi-branch</option></select>
          <select className={selSm} value={conv.cycle} onChange={(e) => setConv({ ...conv, cycle: e.target.value })}><option value="m">Monthly</option><option value="y">Yearly</option></select>
          <input required className={selSm + " w-[110px]"} placeholder="₹ amount" inputMode="decimal" value={conv.amountRupees} onChange={(e) => setConv({ ...conv, amountRupees: e.target.value })} />
          <input className={selSm + " w-[130px]"} placeholder="Reference" value={conv.reference} onChange={(e) => setConv({ ...conv, reference: e.target.value })} />
          <button className={btn} disabled={busy}>Record conversion</button>
        </form>
      ) : null}
      {!l.pipelineLeadId && l.phone ? <button className={btn + " self-start"} disabled={busy} onClick={() => run(() => act.handOff(l.id, "pro"), (code) => `Added to the sales pipeline as ${code}; commission follows the usual flow.`)}>Hand off to sales pipeline (commission)</button> : l.pipelineLeadId ? <span className="text-muted">In the sales pipeline.</span> : null}
    </div>
  );
}

function Message({ leadId, templates }: { leadId: string; templates: { id: string; channel: string; name: string; language: string }[] }) {
  const { run, busy } = useRun();
  const [channel, setChannel] = useState<"whatsapp" | "email">("whatsapp");
  const [tpl, setTpl] = useState("");
  const list = templates.filter((t) => t.channel === channel);
  return (
    <Panel title="Send a message" sub="Approved templates; needs recorded consent and no opt-out">
      <div className="flex gap-2 p-4 flex-wrap">
        <select className={selSm} value={channel} onChange={(e) => { setChannel(e.target.value as "email"); setTpl(""); }}><option value="whatsapp">WhatsApp</option><option value="email">Email</option></select>
        <select className={selSm + " flex-1"} value={tpl} onChange={(e) => setTpl(e.target.value)}><option value="">{list.length ? "Choose template" : "No approved templates"}</option>{list.map((t) => <option key={t.id} value={t.id}>{t.name} ({t.language})</option>)}</select>
        <button className={btnPrimary} disabled={busy || !tpl} onClick={() => run(() => act.sendMessage({ leadId, channel, templateId: tpl }))}>Send</button>
      </div>
    </Panel>
  );
}
