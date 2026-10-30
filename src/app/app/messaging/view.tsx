"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { dayMonth } from "@/lib/dates";
import type { CrmSettings, listCampaigns, optOuts, refillReminders } from "@/domain/comms/crm";
import { crmAction, draftAction, sendAction, sendRefillsAction } from "./actions";

const card = "bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] p-4 flex flex-col gap-2.5";
const sel = "border border-input rounded-lg px-2 py-1.5 text-[13px] bg-white";

export function CrmView({ s, reminders, campaigns, outs, counts, templates, connected }: {
  s: CrmSettings; reminders: Awaited<ReturnType<typeof refillReminders>>; campaigns: Awaited<ReturnType<typeof listCampaigns>>;
  outs: Awaited<ReturnType<typeof optOuts>>; counts: { opted: number; all: number }; templates: string[]; connected: boolean;
}) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [p, setP] = useState(s);
  const [name, setName] = useState(""), [tpl, setTpl] = useState(templates[0] ?? "");
  const save = (patch: Partial<CrmSettings>) => { setP({ ...p, ...patch }); start(async () => { const r = await crmAction(patch); if (!r.ok) toast(r.error, "red"); }); };
  const toggle = (k: "refill" | "feedback", v: boolean) => save({ [k]: v });
  const tplOptions = (cur: string) => [...new Set([cur, ...templates])].map((x) => <option key={x} value={x}>{x}{templates.includes(x) ? "" : " (not approved)"}</option>);
  const sendRefills = () => start(async () => {
    const r = await sendRefillsAction();
    if (!r.ok) return toast(r.error, "red");
    toast(r.data.sent || r.data.failed ? `Refill reminders: ${r.data.sent} sent${r.data.failed ? `, ${r.data.failed} failed` : ""}.` : "No reminders due that haven’t been sent already.", r.data.failed && !r.data.sent ? "red" : "green");
  });
  // The server sends in time-boxed runs and skips recipients already handled, so repeating finishes (or resumes) it.
  const send = (c: { id: string; name: string; audience: number; status: string }) => {
    if (!confirm(c.status === "draft" ? `Send “${c.name}” to ${c.audience} opted-in customers?` : `Resume “${c.name}”? Customers who already got it are skipped.`)) return;
    start(async () => {
      let ok = 0, bad = 0;
      for (;;) {
        const r = await sendAction(c.id);
        if (!r.ok) return toast(ok || bad ? `Stopped after ${ok} sent: ${r.error} Resume to continue.` : r.error, "red");
        ok += r.data.ok; bad += r.data.bad;
        if (r.data.done) break;
        toast(`Sending… ${ok} sent so far.`, "blue");
      }
      toast(`Sent to ${ok}${bad ? `, ${bad} failed` : ""}.`, bad && !ok ? "red" : "green");
    });
  };
  return (
    <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(100%,440px),1fr))] max-w-[1300px] items-start">
      <div className="flex flex-col gap-4">
        <div className={card}>
          <div className="flex items-baseline justify-between"><div className="font-semibold text-[15px]">Programs</div><span className="text-[12.5px] text-muted">{counts.opted} of {counts.all} customers opted in</span></div>
          <label className="flex gap-3 cursor-pointer items-start"><input type="checkbox" className="accent-teal size-4 mt-1" checked={p.refill} onChange={(e) => toggle("refill", e.target.checked)} /><span className="flex flex-col"><span className="text-[14px] font-medium">Refill reminders</span><span className="text-[12.5px] text-muted">Based only on how often a customer buys an item. Medoro does not infer conditions or target by health. Sent once a day from 10:00, once per refill.</span></span></label>
          {p.refill ? (
            <div className="flex gap-2 items-center flex-wrap pl-7 text-[12.5px] text-muted">
              Template <select value={p.refillTemplate} onChange={(e) => save({ refillTemplate: e.target.value })} aria-label="Refill template" className={sel}>{tplOptions(p.refillTemplate)}</select>
              <span className="text-faint">{"{{1}}"} name · {"{{2}}"} medicine · {"{{3}}"} due date</span>
            </div>
          ) : null}
          <label className="flex gap-3 cursor-pointer items-start"><input type="checkbox" className="accent-teal size-4 mt-1" checked={p.feedback} onChange={(e) => toggle("feedback", e.target.checked)} /><span className="flex flex-col"><span className="text-[14px] font-medium">Feedback request</span><span className="text-[12.5px] text-muted">One message after a purchase, at most once a month per customer.</span></span></label>
          {p.feedback ? (
            <div className="flex gap-2 items-center flex-wrap pl-7 text-[12.5px] text-muted">
              Template <select value={p.feedbackTemplate} onChange={(e) => save({ feedbackTemplate: e.target.value })} aria-label="Feedback template" className={sel}>{tplOptions(p.feedbackTemplate)}</select>
              <select value={p.feedbackHours} onChange={(e) => save({ feedbackHours: Number(e.target.value) })} aria-label="Hours after purchase" className={sel}>{[1, 2, 4, 8, 24, 48].map((h) => <option key={h} value={h}>{h} h after purchase</option>)}</select>
              <span className="text-faint">{"{{1}}"} name · {"{{2}}"} invoice no.</span>
            </div>
          ) : null}
        </div>
        {p.refill ? (
          <div className={card}>
            <div className="flex items-center justify-between gap-2"><div className="font-semibold text-[15px]">Upcoming refill reminders</div>{connected ? <Button size="sm" disabled={pending} onClick={sendRefills}>Send due now</Button> : null}</div>
            {reminders.length ? reminders.map((r) => (
              <div key={r.customerId + r.medicine} className="flex flex-col py-1.5 border-b border-row last:border-0 text-[13.5px]">
                <span className="flex gap-2 items-center flex-wrap"><span><strong className="font-semibold">{r.customer}</strong> · {r.medicine} · <span style={{ color: r.inDays < 0 ? "#B3261E" : "#0B5E5B" }}>{r.inDays < 0 ? `${-r.inDays} d overdue` : r.inDays === 0 ? "today" : `in ${r.inDays} d`}</span></span>
                  {r.reminder ? <Badge tone={r.reminder === "failed" ? "red" : r.reminder === "queued" ? "amber" : "green"}>Reminder {r.reminder}</Badge> : null}</span>
                <span className="text-[12px] text-faint">Buys about every {r.interval} days (last on {dayMonth(new Date(r.last + "T00:00:00Z"))})</span>
              </div>
            )) : <div className="text-[13px] text-fainter">Reminders appear when an opted-in customer has bought the same item at least twice and is due within a week.</div>}
            <div className="text-[12px] text-faint">Reminders go to customers due within 2 days (or up to a week overdue), one message per customer a day.</div>
          </div>
        ) : null}
      </div>
      <div className="flex flex-col gap-4">
        <div className={card}>
          <div className="font-semibold text-[15px]">Campaigns</div>
          {campaigns.map((c) => (
            <div key={c.id} className="flex items-center gap-3 py-1.5 border-b border-row text-[13.5px]">
              <div className="flex flex-col flex-1 min-w-0"><strong className="font-semibold">{c.name}</strong><span className="text-[12px] text-faint">{c.template} · {c.audience} opted in · {dayMonth(new Date(c.createdAt))}</span></div>
              <Badge tone={c.status === "sent" ? "green" : c.status === "draft" ? "blue" : c.status === "failed" ? "red" : "amber"}>{c.status === "sent" ? `Sent · ${c.delivered} delivered${c.failed ? ` · ${c.failed} failed` : ""}` : c.status === "sending" || c.status === "failed" ? `${c.status === "failed" ? "Stopped" : "Sending"} · ${c.handled} of ~${c.audience}` : c.status}</Badge>
              {c.status === "draft" && connected ? <Button size="sm" variant="primary" disabled={pending} onClick={() => send(c)}>Send</Button> : null}
              {(c.status === "sending" || c.status === "failed") && connected ? <Button size="sm" disabled={pending} onClick={() => send(c)}>Resume</Button> : null}
            </div>
          ))}
          {connected ? (
            <div className="flex gap-2 flex-wrap">
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New campaign name" className="border border-input rounded-lg px-3 py-2 text-[13.5px] flex-1 min-w-[180px] outline-none focus:border-teal" />
              <select value={tpl} onChange={(e) => setTpl(e.target.value)} className="border border-input rounded-lg px-2 text-[13px] bg-white">{templates.length ? templates.map((x) => <option key={x}>{x}</option>) : <option value="">No approved templates</option>}</select>
              <Button disabled={pending || !tpl} onClick={() => start(async () => { const r = await draftAction(name, tpl); toast(r.ok ? r.message! : r.error, r.ok ? "green" : "red"); if (r.ok) setName(""); })}>Save draft</Button>
            </div>
          ) : <div className="text-[13px] text-muted">Connect WhatsApp Business to create campaigns.</div>}
          <div className="text-[12px] text-faint">Sends only to opted-in customers through templates approved by Meta. Customers can reply STOP to opt out at any time.</div>
        </div>
        <div className={card}>
          <div className="font-semibold text-[15px]">Opt-outs</div>
          {outs.length ? outs.map((o, i) => <div key={i} className="flex gap-3 text-[13px] py-1 border-b border-row last:border-0"><span className="font-mono">{o.phone}</span><span className="text-muted flex-1">{o.via}{o.at ? ` · ${dayMonth(new Date(o.at))}` : ""}</span><span className="text-ok text-[12px]">Honoured automatically</span></div>)
            : <div className="text-[13px] text-fainter">No opt-outs.</div>}
        </div>
      </div>
    </div>
  );
}
