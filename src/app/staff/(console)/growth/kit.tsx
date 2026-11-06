"use client";
import { useState } from "react";
import Link from "next/link";
import { Copy, Phone, PhoneCall } from "lucide-react";
import { useToast } from "@/components/ui/toast";
import { CONNECTED_OUTCOMES, OUTCOMES, SOFTWARE_STATUS, VERIFICATION_LABEL, stageLabel, type Outcome } from "@/staff/growth/constants";
import { displayPhone } from "@/staff/growth/normalize";
import { launchCall, reportCall } from "../../growth-actions";
import { Pill, btn, btnPrimary, fieldCls, lbl, useRun } from "../ui";
import { localToIso } from "./fmt";
export { fmtD, fmtDT, localToIso } from "./fmt";

export const STAGE_TONE: Record<string, [string, string]> = {
  NEW_LEAD: ["#EEF0F2", "#3D454D"], RESEARCH_PENDING: ["#FFF4E0", "#94570A"], QUALIFIED: ["#EAF0FC", "#2459C9"], ASSIGNED: ["#EAF0FC", "#0B3A78"],
  CONTACT_PERMISSION_PENDING: ["#FFF4E0", "#94570A"], CONTACT_AUTHORIZED: ["#E1F1EF", "#0B5E5B"], FIRST_CONTACT: ["#E1F1EF", "#0B5E5B"], INTERESTED: ["#E3F5EC", "#18794E"],
  DEMO_SCHEDULED: ["#EFEBFA", "#5B45B0"], DEMO_COMPLETED: ["#EFEBFA", "#5B45B0"], TRIAL_STARTED: ["#FFF4E0", "#94570A"], NEGOTIATION: ["#FFF4E0", "#94570A"],
  CONVERTED: ["#E3F5EC", "#18794E"], LOST: ["#FBEAE9", "#C0362C"], FOLLOW_UP_LATER: ["#EEF0F2", "#3D454D"], DO_NOT_CONTACT: ["#FBEAE9", "#C0362C"],
};
export const StageBadge = ({ s }: { s: string }) => { const [bg, fg] = STAGE_TONE[s] ?? ["#EEF0F2", "#3D454D"]; return <Pill bg={bg} fg={fg}>{stageLabel(s)}</Pill>; };
export const VerifyBadge = ({ v }: { v: string }) => {
  const t: [string, string] = v === "UNVERIFIED" ? ["#EEF0F2", "#3D454D"] : v === "INVALID" || v === "DUPLICATE" ? ["#FBEAE9", "#C0362C"] : v === "PARTIALLY_VERIFIED" ? ["#E1F1EF", "#0B5E5B"] : ["#E3F5EC", "#18794E"];
  return <Pill bg={t[0]} fg={t[1]}>{VERIFICATION_LABEL[v] ?? v}</Pill>;
};
const PROV: Record<string, [string, string, string]> = {
  verified: ["#E3F5EC", "#18794E", "Verified"], user_provided: ["#EAF0FC", "#2459C9", "Told to us"], source: ["#EEF0F2", "#3D454D", "From source"],
  inferred: ["#FFF4E0", "#94570A", "AI-inferred"], unknown: ["#F5F6F7", "#6B7480", "Unknown"],
};
export const Prov = ({ p }: { p: string }) => { const [bg, fg, l] = PROV[p] ?? PROV.unknown; return <span className="px-1.5 py-px rounded text-[11px] font-semibold whitespace-nowrap" style={{ background: bg, color: fg }}>{l}</span>; };
export const ScoreChip = ({ n }: { n: number }) => <span className={`tnum font-bold text-[13px] ${n >= 60 ? "text-[#18794E]" : n >= 35 ? "text-[#94570A]" : "text-muted"}`}>{n}</span>;

export function ScoreBreakdown({ lines, total }: { lines: { key: string; label: string; max: number; points: number; provenance: string; evidence: string }[]; total: number }) {
  return (
    <div className="flex flex-col gap-2 p-4">
      <div className="flex items-baseline gap-2"><span className="text-[28px] font-bold tnum">{total}</span><span className="text-muted text-[13px]">/ 100</span></div>
      {lines.map((l) => (
        <div key={l.key} className="flex flex-col gap-1">
          <div className="flex items-center gap-2 text-[13px]"><span className="flex-1">{l.label}</span><Prov p={l.provenance} /><span className="tnum font-semibold w-[52px] text-right">{l.points}/{l.max}</span></div>
          <div className="h-1.5 rounded bg-[#EEF0F2] overflow-hidden"><div className="h-full bg-teal" style={{ width: `${(l.points / l.max) * 100}%` }} /></div>
          <span className="text-[12px] text-muted">{l.evidence}</span>
        </div>
      ))}
    </div>
  );
}

export const isoToLocal = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);

/** Opens the phone's dialer through a tel: link click (works in Android Chrome, iPhone Safari and desktop handlers). */
export function openDialer(uri: string) {
  const a = document.createElement("a");
  a.href = uri; a.rel = "noopener"; a.style.display = "none";
  document.body.appendChild(a); a.click(); a.remove();
}

/**
 * CALL PHARMACY: the server checks the assignment and the number and records a call session; then the phone's own dialer
 * opens with a tel: link and the employee calls from their own SIM. Nothing reads the call itself.
 */
export function CallButton({ leadId, phone, onSession, compact }: { leadId: string; phone: string | null; onSession?: (s: { callSessionId: string; dialerUri: string; phone: string }) => void; compact?: boolean }) {
  const { run, busy } = useRun();
  const toast = useToast();
  const [s, setS] = useState<{ callSessionId: string; dialerUri: string; phone: string } | null>(null);
  if (!phone) return <span className="text-muted text-[12.5px]">No valid number</span>;
  const go = () => run(() => launchCall(leadId), (r) => { setS(r); onSession?.(r); openDialer(r.dialerUri); return r.reused ? "Your open call for this pharmacy is used again." : undefined; });
  const copy = async () => { try { await navigator.clipboard.writeText(phone); toast("Number copied.", "green"); } catch { toast(phone); } };
  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap">
      <button type="button" disabled={busy} onClick={go} className={compact ? btn : btnPrimary}><PhoneCall size={compact ? 14 : 16} />{compact ? "Call" : "CALL PHARMACY"}</button>
      {s ? <a href={s.dialerUri} className={btn}><Phone size={14} />Open dialer again</a> : null}
      {!compact ? <button type="button" onClick={copy} className={btn} title="Copy the number if your device has no dialer"><Copy size={14} />{displayPhone(phone)}</button> : null}
    </span>
  );
}

/** The report the employee fills after the call. One submit per call (an idempotency key guards double taps). */
export function CallReportForm({ sessionId, onDone }: { sessionId: string; onDone?: () => void }) {
  const { run, busy } = useRun();
  const [outcome, setOutcome] = useState<Outcome>("CONNECTED");
  const [f, setF] = useState({ interestLevel: "medium", notes: "", followUpAt: "", numberConfirmed: false, softwareStatus: "", demoAt: "", demoMode: "phone", product: "pro", cycle: "m", amount: "", reference: "", wa: false, email: false });
  const [key] = useState(() => "rep-" + sessionId + "-" + Math.random().toString(36).slice(2, 10));
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });
  const connected = (CONNECTED_OUTCOMES as string[]).includes(outcome);
  const needFu = outcome === "FOLLOW_UP_REQUIRED" || outcome === "INTERESTED";
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    run(() => reportCall(sessionId, {
      outcome, interestLevel: f.interestLevel as "none", notes: f.notes, followUpAt: f.followUpAt ? localToIso(f.followUpAt) : null, numberConfirmed: connected && f.numberConfirmed,
      softwareStatus: f.softwareStatus as "", demoRequested: outcome === "DEMO_SCHEDULED",
      demo: outcome === "DEMO_SCHEDULED" && f.demoAt ? { at: localToIso(f.demoAt), mode: f.demoMode as "phone" } : undefined,
      conversion: outcome === "CONVERTED" ? { product: f.product as "pro", cycle: f.cycle as "m", amountRupees: f.amount || "0", reference: f.reference } : undefined,
      consentChannels: connected ? ([f.wa ? "whatsapp" : null, f.email ? "email" : null].filter(Boolean) as ("whatsapp" | "email")[]) : [],
      idempotencyKey: key,
    }), () => { onDone?.(); });
  };
  return (
    <form onSubmit={submit} className="grid gap-3 p-4 min-[700px]:grid-cols-2">
      <label className={lbl}>Call outcome *
        <select className={fieldCls} value={outcome} onChange={(e) => setOutcome(e.target.value as Outcome)}>{OUTCOMES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </label>
      <label className={lbl}>Interest level *
        <select className={fieldCls} value={f.interestLevel} onChange={set("interestLevel")}><option value="none">None</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select>
      </label>
      <label className={lbl + " min-[700px]:col-span-2"}>Discussion notes *
        <textarea required minLength={3} rows={3} className={fieldCls} value={f.notes} onChange={set("notes")} placeholder="What was discussed, or why the call didn’t connect" />
      </label>
      <label className={lbl}>Next follow-up {needFu ? "*" : ""}
        <input type="datetime-local" className={fieldCls} value={f.followUpAt} onChange={set("followUpAt")} required={needFu} />
      </label>
      <label className={lbl}>How do they bill today? (as told)
        <select className={fieldCls} value={f.softwareStatus} onChange={set("softwareStatus")}>{SOFTWARE_STATUS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
      </label>
      {outcome === "DEMO_SCHEDULED" ? (<>
        <label className={lbl}>Demo date and time *<input type="datetime-local" required className={fieldCls} value={f.demoAt} onChange={set("demoAt")} /></label>
        <label className={lbl}>Demo by<select className={fieldCls} value={f.demoMode} onChange={set("demoMode")}><option value="phone">Phone</option><option value="video">Video call</option><option value="visit">Visit</option></select></label>
      </>) : null}
      {outcome === "CONVERTED" ? (<>
        <label className={lbl}>Plan *<select className={fieldCls} value={f.product} onChange={set("product")}><option value="starter">Starter</option><option value="pro">Professional</option><option value="multi">Multi-branch</option></select></label>
        <label className={lbl}>Billing<select className={fieldCls} value={f.cycle} onChange={set("cycle")}><option value="m">Monthly</option><option value="y">Yearly</option></select></label>
        <label className={lbl}>Amount (₹) *<input required inputMode="decimal" className={fieldCls} value={f.amount} onChange={set("amount")} /></label>
        <label className={lbl}>Payment reference<input className={fieldCls} value={f.reference} onChange={set("reference")} placeholder="UTR / invoice no." /></label>
      </>) : null}
      {connected && outcome !== "DO_NOT_CONTACT" ? (
        <fieldset className="min-[700px]:col-span-2 flex flex-col gap-1.5 text-[13px]">
          <label className="flex gap-2 items-start"><input type="checkbox" checked={f.numberConfirmed} onChange={set("numberConfirmed")} className="mt-1" /><span>The person who answered confirmed this number belongs to this pharmacy <span className="text-muted">(marks the phone verified)</span></span></label>
          <span className="text-muted mt-1">The owner agreed to receive Medoro product information on:</span>
          <label className="flex gap-2"><input type="checkbox" checked={f.wa} onChange={set("wa")} />WhatsApp</label>
          <label className="flex gap-2"><input type="checkbox" checked={f.email} onChange={set("email")} />Email</label>
        </fieldset>
      ) : null}
      {outcome === "DO_NOT_CONTACT" ? <p className="min-[700px]:col-span-2 text-[13px] text-[#C0362C]">The number and email go on the do-not-contact list and open follow-ups are cancelled.</p> : null}
      <div className="min-[700px]:col-span-2 flex gap-2 items-center">
        <button disabled={busy} className={btnPrimary}>Submit call report</button>
        <span className="text-[12px] text-muted">Reports are your account of the call; Medoro doesn’t read call logs or record calls.</span>
      </div>
    </form>
  );
}

export const LeadLink = ({ id, name, code }: { id: string; name: string; code?: string }) => <Link href={`/staff/growth/leads/${id}`} className="font-semibold hover:text-teal">{name}{code ? <span className="text-muted font-normal text-[12px]"> · {code}</span> : null}</Link>;

export function downloadText(name: string, text: string, type = "text/csv;charset=utf-8") {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.appendChild(a); a.click(); a.remove();
}
export const outcomeOptions = OUTCOMES;
