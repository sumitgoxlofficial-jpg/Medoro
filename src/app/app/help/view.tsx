"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { LifeBuoy, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, type Tone } from "@/components/ui/badge";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { WA } from "@/components/site/chrome";
import { TICKET_CATEGORIES } from "@/staff/constants";
import type { supportInbox } from "@/domain/system/licence";
import { openTicketAction, replyTicketAction } from "./actions";

type Inbox = Awaited<ReturnType<typeof supportInbox>>;
const card = "bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] p-4 flex flex-col gap-3";
const when = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const STATUS: Record<string, [string, Tone]> = { open: ["Open", "blue"], waiting: ["Waiting for you", "amber"], resolved: ["Resolved", "green"] };

export function HelpView({ inbox, canWrite }: { inbox: Inbox; canWrite: boolean }) {
  const toast = useToast();
  const router = useRouter();
  const [busy, start] = useTransition();
  const [form, setForm] = useState({ subject: "", category: "General", message: "" });
  const [reply, setReply] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(inbox.tickets.find((t) => t.status !== "resolved")?.code ?? null);
  const seen = inbox.seenAt ? Date.parse(inbox.seenAt) : 0;

  const act = (fn: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>, after?: () => void) => start(async () => {
    const r = await fn();
    if (!r.ok) return toast(r.error, "red");
    if (r.message) toast(r.message, "green");
    after?.(); router.refresh();
  });

  return (
    <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))] max-w-[1200px] items-start">
      <div className="flex flex-col gap-4">
        <div className={card}>
          <div className="flex items-center gap-2 font-semibold text-[15px]"><LifeBuoy size={17} className="text-teal" />Support inbox</div>
          {!inbox.tickets.length && !inbox.pending.length ? <div className="text-[13px] text-faint">{inbox.connected ? (canWrite ? "No tickets yet. Write to Medoro support with the form on this page." : "No tickets yet.") : "Support tickets can’t be sent from this installation yet. Use WhatsApp support instead."}</div> : null}
          {inbox.pending.filter((p) => p.kind === "ticket").map((p) => (
            <div key={p.id} className="border border-line rounded-lg px-3 py-2 text-[13.5px] flex gap-2 items-center">
              <span className="flex-1">{p.payload.subject}<span className="text-muted"> · {when(p.at)}</span></span><Badge tone="gray">Waiting to send</Badge>
            </div>
          ))}
          {inbox.tickets.map((t) => {
            const fresh = t.messages.filter((m) => !m.fromCustomer && Date.parse(m.at) > seen).length;
            const queued = inbox.pending.filter((p) => p.kind === "ticket_reply" && p.payload.code === t.code);
            return (
              <div key={t.code} className="border border-line rounded-lg">
                <button type="button" onClick={() => setOpen(open === t.code ? null : t.code)} className="w-full flex gap-2 items-center px-3 py-2.5 text-left cursor-pointer">
                  <span className="flex-1 min-w-0 text-[13.5px]"><span className="font-mono text-muted">{t.code}</span> · <strong>{t.subject}</strong><span className="text-muted"> · {when(t.createdAt)}</span></span>
                  {fresh ? <Badge tone="teal">{fresh} new</Badge> : null}
                  <Badge tone={STATUS[t.status]?.[1] ?? "gray"}>{STATUS[t.status]?.[0] ?? t.status}</Badge>
                </button>
                {open === t.code ? (
                  <div className="border-t border-row px-3 py-2.5 flex flex-col gap-2">
                    {t.messages.map((m) => (
                      <div key={m.id} className={`rounded-lg px-3 py-2 text-[13.5px] max-w-[90%] ${m.fromCustomer ? "self-end bg-teal-tint" : "self-start bg-page"}`}>
                        <div className="whitespace-pre-wrap">{m.text}</div>
                        <div className="text-[11.5px] text-muted mt-0.5">{m.by} · {when(m.at)}</div>
                      </div>
                    ))}
                    {queued.map((q) => <div key={q.id} className="self-end rounded-lg px-3 py-2 text-[13.5px] bg-chip max-w-[90%]"><div className="whitespace-pre-wrap">{q.payload.text}</div><div className="text-[11.5px] text-muted">Waiting to send</div></div>)}
                    {canWrite ? (
                      <form onSubmit={(e) => { e.preventDefault(); act(() => replyTicketAction(t.code, reply[t.code] ?? ""), () => setReply({ ...reply, [t.code]: "" })); }} className="flex gap-2 items-end">
                        <Textarea aria-label="Reply" rows={2} className="flex-1" value={reply[t.code] ?? ""} onChange={(e) => setReply({ ...reply, [t.code]: e.target.value })} placeholder={t.status === "resolved" ? "Reply to reopen this ticket" : "Write a reply"} />
                        <Button type="submit" variant="primary" disabled={busy || !(reply[t.code] ?? "").trim()}>Send</Button>
                      </form>
                    ) : null}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      <div className="flex flex-col gap-4">
        {inbox.connected && canWrite ? (
          <form onSubmit={(e) => { e.preventDefault(); act(() => openTicketAction(form), () => setForm({ subject: "", category: "General", message: "" })); }} className={card}>
            <div className="font-semibold text-[15px]">Write to Medoro support</div>
            <Field label="Subject"><Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} maxLength={140} placeholder="Printer cuts the receipt short" required /></Field>
            <Field label="Topic"><Select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}>{TICKET_CATEGORIES.map((c) => <option key={c}>{c}</option>)}</Select></Field>
            <Field label="What happened?" hint="Don’t include customer or patient details. If support needs to look at your data, they’ll ask for access and you approve it under Privacy & data."><Textarea rows={5} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} maxLength={4000} required /></Field>
            <Button type="submit" variant="primary" className="self-start" disabled={busy}>Send to support</Button>
          </form>
        ) : null}
        <div className={card}>
          <div className="font-semibold text-[15px]">Other ways to reach us</div>
          {!inbox.connected ? <div className="text-[13px] text-ink-2">This installation isn’t connected to Medoro’s licence server, so tickets can’t be sent from here.</div> : null}
          <a href={WA} target="_blank" rel="noreferrer" className="self-start min-h-10 inline-flex items-center gap-2 text-[13.5px] font-semibold text-teal"><MessageCircle size={15} />WhatsApp Medoro support</a>
          <a href="/legal#help" target="_blank" className="self-start min-h-10 inline-flex items-center text-[13.5px] text-teal">Help & setup guide</a>
        </div>
      </div>
    </div>
  );
}

