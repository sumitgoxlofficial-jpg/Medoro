"use client";
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { openThread, sendMessage } from "../../../growth-actions";
import { Empty, Panel, Tabs, btnPrimary, fieldCls, useRun } from "../../ui";
import { StageBadge, fmtDT } from "../kit";

type C = Awaited<ReturnType<typeof import("@/staff/growth/comms").inbox>>[number];
type T = Extract<Awaited<ReturnType<typeof openThread>>, { ok: true }>["data"];

export function InboxView({ convs, channel, unread }: { convs: C[]; channel: string; unread: boolean }) {
  const router = useRouter();
  const { run, busy } = useRun();
  const [cur, setCur] = useState<C | null>(null);
  const [t, setT] = useState<T | null>(null);
  const [text, setText] = useState("");
  const open = (c: C) => { setCur(c); run(() => openThread(c.id), setT); };
  return (
    <div className="grid gap-4 min-[1000px]:grid-cols-[360px_minmax(0,1fr)]">
      <Panel title="Conversations" right={<Tabs value={channel || "all"} options={[["all", "All"], ["whatsapp", "WhatsApp"], ["email", "Email"]]} onChange={(v) => router.push(`?channel=${v === "all" ? "" : v}${unread ? "&unread=1" : ""}`)} />}>
        <label className="flex gap-2 items-center px-4 py-2 text-[12.5px]"><input type="checkbox" checked={unread} onChange={(e) => router.push(`?channel=${channel}${e.target.checked ? "&unread=1" : ""}`)} />Unread only</label>
        {convs.length ? convs.map((c) => (
          <button key={c.id} onClick={() => open(c)} className={`w-full text-left px-4 py-2.5 border-t border-[#F1F3F4] text-[13px] ${cur?.id === c.id ? "bg-teal-tint" : "hover:bg-[#FAFBFB]"}`}>
            <div className="flex gap-2"><strong className="flex-1 truncate">{c.lead?.name ?? c.address}</strong>{c.unread ? <span className="min-w-[18px] h-[18px] px-[5px] rounded-[9px] bg-teal text-white text-[11px] font-bold flex items-center justify-center">{c.unread}</span> : null}</div>
            <div className="text-muted truncate">{c.channel} · {c.last || "—"}</div>
            <div className="text-muted text-[11.5px]">{fmtDT(c.lastMessageAt)}{c.lead?.assignee ? ` · ${c.lead.assignee}` : ""}</div>
          </button>
        )) : <Empty>No conversations yet.</Empty>}
      </Panel>
      <Panel title={cur ? (cur.lead?.name ?? cur.address) : "Conversation"} sub={cur?.lead ? `${cur.channel} · ${cur.address} · next follow-up ${fmtDT(cur.lead.nextFollowUpAt)}` : undefined} right={cur?.lead ? <><StageBadge s={cur.lead.stage} /><Link className="text-teal text-[12.5px] font-semibold" href={`/staff/growth/leads/${cur.lead.id}`}>Lead →</Link></> : null}>
        {t ? (<>
          <div className="flex flex-col gap-2 p-4 max-h-[60vh] overflow-auto">
            {t.events.map((e) => (
              <div key={e.id} className={`max-w-[80%] rounded-xl px-3 py-2 text-[13.5px] ${e.direction === "out" ? "self-end bg-teal-tint" : "self-start bg-[#F1F3F4]"}`}>
                <div className="whitespace-pre-wrap">{e.body}</div>
                <div className="text-muted text-[11px] mt-0.5">{fmtDT(e.at)}{e.staffName ? ` · ${e.staffName}` : ""}{e.direction === "out" ? ` · ${e.status}` : ""}{e.error ? ` · ${e.error}` : ""}</div>
              </div>
            ))}
          </div>
          {cur?.lead && cur.channel === "whatsapp" ? (
            t.inWindow ? (
              <form className="flex gap-2 p-4 border-t border-[#EEF0F2]" onSubmit={(e) => { e.preventDefault(); run(() => sendMessage({ leadId: cur.lead!.id, channel: "whatsapp", text }), () => { setText(""); open(cur); }); }}>
                <input className={fieldCls} value={text} onChange={(e) => setText(e.target.value)} placeholder="Reply (within 24 hours of their message)" /><button className={btnPrimary} disabled={busy || !text.trim()}>Send</button>
              </form>
            ) : <div className="p-4 border-t border-[#EEF0F2] text-[12.5px] text-muted">Outside WhatsApp’s 24-hour window: send an approved template from the lead page.</div>
          ) : null}
        </>) : <Empty>{busy ? "Loading…" : "Pick a conversation."}</Empty>}
      </Panel>
    </div>
  );
}
