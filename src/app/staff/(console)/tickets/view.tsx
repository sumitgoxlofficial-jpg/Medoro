"use client";
import Link from "next/link";
import { useState } from "react";
import { ArrowUpCircle, MessageCircle, Timer, X } from "lucide-react";
import { MACROS, PRIORITY, TICKET_STATUS } from "@/staff/constants";
import { escalateTicket, replyTicket, requestRemote, updateTicket } from "../../actions";
import { Empty, Pill, Tabs, btn, btnPrimary, fmtTime, panel, selSm, useRun } from "../ui";

type Row = { id: string; code: string; subject: string; customer: string; priority: string; status: string; createdAt: string; assigneeId: string | null };
type Detail = NonNullable<Awaited<ReturnType<typeof import("@/staff/support").ticketDetail>>>;
const PC: Record<string, [string, string]> = { high: ["#FDECEC", "#C0362C"], medium: ["#FDF2E1", "#94570A"], low: ["#F2F4F5", "#5B636B"] };
const TS: Record<string, string> = { open: "#C0362C", waiting: "#94570A", resolved: "#18794E" };
type F = "open" | "waiting" | "resolved" | "all";

function sla(d: Detail, now: number) {
  if (d.status === "resolved" || d.firstResponseAt) {
    const late = d.firstResponseAt && d.firstResponseAt > d.firstResponseDue;
    return late ? ["First response was late", "#FDF2E1", "#94570A"] : ["First response within SLA", "#E7F6EE", "#18794E"];
  }
  const min = Math.round((new Date(d.firstResponseDue).getTime() - now) / 60000);
  if (min < 0) return [`First-response SLA breached ${Math.abs(min)} min ago`, "#FDECEC", "#C0362C"];
  return [`First response due in ${min >= 60 ? `${Math.floor(min / 60)} h ${min % 60} min` : `${min} min`}`, min < 60 ? "#FDF2E1" : "#F2F4F5", min < 60 ? "#94570A" : "#3D454D"];
}

export function TicketsView({ rows, detail: d, team, filter, now }: { rows: Row[]; detail: Detail | null; team: { id: string; name: string }[]; filter: F; now: number }) {
  const { run, busy } = useRun();
  const [f, setF] = useState<F>(filter);
  const [mode, setMode] = useState<"public" | "internal">("public");
  const [reply, setReply] = useState("");
  const list = rows.filter((t) => f === "all" || (f === "open" ? t.status !== "resolved" : t.status === f));
  const name = (id: string | null) => team.find((m) => m.id === id)?.name ?? "Unassigned";
  const send = (resolve: boolean) => d && run(() => replyTicket(d.id, reply, mode === "internal", resolve), () => setReply(""));
  const s = d ? sla(d, now) : null;

  return (
    <>
      <Tabs value={f} onChange={setF} options={[["open", "Open"], ["waiting", "Waiting on customer"], ["resolved", "Resolved"], ["all", "All"]]} />
      <div className={`grid gap-4 items-start grid-cols-1 ${d ? "min-[1200px]:grid-cols-[minmax(0,1.4fr)_minmax(340px,1fr)]" : ""}`}>
        <div className="flex flex-col gap-2">
          {list.map((t) => (
            <Link key={t.id} href={`/staff/tickets?t=${t.id}&f=${f}`} className={`flex flex-col gap-1 bg-white rounded-[10px] px-3.5 py-3 text-ink hover:text-ink ${d?.id === t.id ? "border-[1.5px] border-teal" : "border border-[#E6E8EB]"}`}>
              <div className="flex gap-2 items-center w-full"><span className="font-mono text-[12px] text-muted">{t.code}</span><Pill bg={PC[t.priority][0]} fg={PC[t.priority][1]}>{PRIORITY[t.priority as keyof typeof PRIORITY]}</Pill><span className="ml-auto text-[12px] font-semibold" style={{ color: TS[t.status] }}>{TICKET_STATUS[t.status as keyof typeof TICKET_STATUS]}</span></div>
              <strong className="text-[14px]">{t.subject}</strong>
              <span className="text-[12.5px] text-muted">{t.customer} · {name(t.assigneeId)} · {fmtTime(t.createdAt)}</span>
            </Link>
          ))}
          {!list.length ? <div className={panel}><Empty>{rows.length ? "Nothing in this view." : "No tickets yet. Open one from a customer’s page when they call or message."}</Empty></div> : null}
        </div>

        {d && s ? (
          <div className={panel + " flex flex-col"}>
            <div className="px-4 py-3.5 border-b border-[#EEF0F2] flex flex-col gap-1.5">
              <div className="flex gap-2 items-center"><strong className="text-[15px]">{d.code} · {d.subject}</strong><Link href={`/staff/tickets?f=${f}`} aria-label="Close" className="ml-auto text-muted flex"><X size={18} /></Link></div>
              <Link href={`/staff/customers?c=${d.customer.id}`} className="self-start text-teal text-[13px] font-semibold">{d.customer.name} · view customer →</Link>
              <div className="flex gap-2 items-center flex-wrap text-[12.5px]">
                <span className="px-[9px] py-[3px] rounded-full font-semibold flex gap-[5px] items-center whitespace-nowrap" style={{ background: s[1], color: s[2] }}><Timer size={13} />{s[0]}</span>
                <span className="text-muted whitespace-nowrap">{d.category} · {d.channel}{d.escalatedTo ? ` · with ${d.escalatedTo}` : ""}</span>
              </div>
              <div className="flex gap-2 flex-wrap">
                <select aria-label="Priority" className={selSm} value={d.priority} onChange={(e) => run(() => updateTicket(d.id, { priority: e.target.value }))}>{Object.entries(PRIORITY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                <button disabled={busy || d.escalatedTo === "Engineering"} className={btn} onClick={() => run(() => escalateTicket(d.id), (to) => `Escalated to ${to}.`)}><ArrowUpCircle size={14} />{d.escalatedTo ? (d.escalatedTo === "Engineering" ? "With Engineering" : "Escalate to Engineering") : "Escalate"}</button>
                <button disabled={busy || d.remote?.status === "requested"} className={btn} onClick={() => run(() => requestRemote(d.customer.id, d.id))}>{d.remote?.status === "requested" ? "Remote access: waiting for owner" : "Request remote access"}</button>
                {d.remote?.access ? <a href={d.remote.access.link} target="_blank" rel="noreferrer" className={btn}>Open approved support session (until {fmtTime(d.remote.access.expiresAt)})</a> : null}
              </div>
              <div className="flex gap-2 flex-wrap">
                <select aria-label="Status" className={selSm} value={d.status} onChange={(e) => run(() => updateTicket(d.id, { status: e.target.value }))}>{Object.entries(TICKET_STATUS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                <select aria-label="Assigned to" className={selSm} value={d.assigneeId ?? ""} onChange={(e) => run(() => updateTicket(d.id, { assigneeId: e.target.value || null }))}><option value="">Unassigned</option>{team.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}</select>
              </div>
            </div>
            <div className="px-4 py-3 flex flex-col gap-2 max-h-[360px] overflow-auto">
              {d.messages.length ? d.messages.map((m) => (
                <div key={m.id} className="max-w-[88%] rounded-[10px] px-[11px] py-2 text-[13.5px]" style={{ alignSelf: m.fromCustomer ? "flex-start" : "flex-end", background: m.internal ? "#FFF7E0" : m.fromCustomer ? "#F2F4F5" : "#E1F1EF", border: m.internal ? "1px dashed #E8C77A" : 0 }}>
                  {m.internal ? <div className="text-[11px] font-bold text-[#94570A] tracking-[.04em] uppercase">Internal note · not sent</div> : null}
                  <div className="whitespace-pre-wrap">{m.text}</div><div className="text-[11px] text-muted mt-0.5">{m.by} · {fmtTime(m.at)}</div>
                </div>
              )) : <span className="text-[13px] text-muted">No messages yet.</span>}
            </div>
            <div className="px-4 py-3 border-t border-[#EEF0F2] flex flex-col gap-2">
              <div className="flex gap-2 flex-wrap items-center">
                <Tabs value={mode} onChange={setMode} options={[["public", "Reply to customer"], ["internal", "Internal note"]]} />
                <select aria-label="Insert saved reply" className={selSm + " ml-auto"} value="" onChange={(e) => { const m = MACROS.find((x) => x.id === e.target.value); if (m) setReply((r) => (r ? r + " " : "") + m.t); }}><option value="">Insert saved reply…</option>{MACROS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
              </div>
              <textarea aria-label="Reply" value={reply} onChange={(e) => setReply(e.target.value)} rows={3} placeholder={mode === "internal" ? "Note for the team. The customer will not see this." : d.channel === "App" ? "Reply to the customer. It reaches Help in their Medoro app at the next check-in." : "Reply to the customer. Save it here, then send it on WhatsApp. If their app is connected, it also appears under Help."} className="rounded-lg px-[11px] py-[9px] text-[13.5px] outline-none resize-y border" style={{ background: mode === "internal" ? "#FFFBEF" : "#fff", borderColor: mode === "internal" ? "#E8C77A" : "#CDD2D7" }} />
              <div className="flex gap-2 justify-end flex-wrap items-center">
                {mode === "public" && reply.trim() ? <a href={`https://wa.me/91${d.customer.phone}?text=${encodeURIComponent(reply)}`} target="_blank" rel="noreferrer" className={btn + " py-[9px] mr-auto"}><MessageCircle size={14} className="text-[#18794E]" />Open in WhatsApp</a> : null}
                <button disabled={busy} className={btn + " py-[9px] px-3"} onClick={() => send(true)}>{reply.trim() ? "Save & resolve" : "Resolve"}</button>
                <button disabled={busy || !reply.trim()} className={btnPrimary} onClick={() => send(false)}>{mode === "internal" ? "Save note" : "Save reply"}</button>
              </div>
            </div>
          </div>
        ) : null}
      </div>
    </>
  );
}
