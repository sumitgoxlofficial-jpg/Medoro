"use client";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { dayMonth } from "@/lib/dates";
import { inr0 } from "@/lib/money";
import type { CrmSettings, listCampaigns, optOuts, paymentDues, refillReminders, smsStatus } from "@/domain/comms/crm";
import type { LoyaltySettings } from "@/domain/sales/loyalty";
import type { SmsType } from "@/server/sms";
import { crmAction, draftAction, loyaltyAction, sendAction, sendPaymentsAction, sendRefillsAction, smsAction } from "./actions";

const card = "bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] p-4 flex flex-col gap-2.5";
const sel = "border border-input rounded-lg px-2 py-1.5 text-[13px] bg-white";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const SMS_LABEL: Record<SmsType, string> = { refill: "Refill reminder", payment: "Payment reminder", campaign: "Store update / campaign", loyalty: "Points earned" };

export function CrmView({ s, reminders, campaigns, outs, counts, templates, connected, dues, sms, loyalty }: {
  s: CrmSettings; reminders: Awaited<ReturnType<typeof refillReminders>>; campaigns: Awaited<ReturnType<typeof listCampaigns>>;
  outs: Awaited<ReturnType<typeof optOuts>>; counts: { opted: number; sms: number; all: number }; templates: string[]; connected: boolean;
  dues: Awaited<ReturnType<typeof paymentDues>>; sms: Awaited<ReturnType<typeof smsStatus>>; loyalty: LoyaltySettings;
}) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [p, setP] = useState(s);
  const [name, setName] = useState(""), [tpl, setTpl] = useState(templates.includes("store_update") ? "store_update" : templates[0] ?? ""), [msg, setMsg] = useState("");
  const [sm, setSm] = useState({ enabled: sms.enabled, templates: { ...sms.templates } as Partial<Record<SmsType, string>> });
  const [ly, setLy] = useState({ enabled: loyalty.enabled, notify: loyalty.notify, template: loyalty.template, earnPer100: String(loyalty.earnPer100), pointValue: String(loyalty.pointValuePaise / 100), minRedeem: String(loyalty.minRedeem), expiryMonths: String(loyalty.expiryMonths) });
  const smsOn = sms.enabled && sms.available;
  const reach = connected || smsOn;
  const remindAll = () => {
    if (!confirm(`Send a payment reminder to every customer with a balance who consented (${dues.filter((d) => d.wa || d.sms).length})?`)) return;
    start(async () => {
      const r = await sendPaymentsAction();
      if (!r.ok) return toast(r.error, "red");
      toast(`Payment reminders: ${r.data.sent} sent${r.data.failed ? `, ${r.data.failed} failed` : ""}${r.data.skipped ? `, ${r.data.skipped} skipped (no consent or already today)` : ""}.`, r.data.failed && !r.data.sent ? "red" : "green");
    });
  };
  const saveLoyalty = (x: Partial<LoyaltySettings>) => start(async () => { const r = await loyaltyAction(x); toast(r.ok ? r.message! : r.error, r.ok ? "green" : "red"); });
  const save = (patch: Partial<CrmSettings>) => { setP({ ...p, ...patch }); start(async () => { const r = await crmAction(patch); if (!r.ok) toast(r.error, "red"); }); };
  const toggle = (k: "refill" | "feedback" | "payment", v: boolean) => save({ [k]: v });
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
          <div className="flex items-baseline justify-between gap-x-3 flex-wrap"><div className="font-semibold text-[15px]">Programs</div><span className="text-[12.5px] text-muted">{counts.opted} of {counts.all} customers opted in on WhatsApp{counts.sms ? ` · ${counts.sms} more by SMS` : ""}</span></div>
          <label className="flex gap-3 cursor-pointer items-start"><input type="checkbox" className="accent-teal size-4 mt-1 flex-none" checked={p.refill} onChange={(e) => toggle("refill", e.target.checked)} /><span className="flex flex-col"><span className="text-[14px] font-medium">Refill reminders</span><span className="text-[12.5px] text-muted">Based only on how often a customer buys an item. Medoro does not infer conditions or target by health. Sent once a day from 10:00, once per refill.</span></span></label>
          {p.refill ? (
            <div className="flex gap-2 items-center flex-wrap pl-7 text-[12.5px] text-muted">
              Template <select value={p.refillTemplate} onChange={(e) => save({ refillTemplate: e.target.value })} aria-label="Refill template" className={sel}>{tplOptions(p.refillTemplate)}</select>
              <span className="text-faint">{"{{1}}"} name · {"{{2}}"} medicine · {"{{3}}"} due date</span>
            </div>
          ) : null}
          <label className="flex gap-3 cursor-pointer items-start"><input type="checkbox" className="accent-teal size-4 mt-1 flex-none" checked={p.feedback} onChange={(e) => toggle("feedback", e.target.checked)} /><span className="flex flex-col"><span className="text-[14px] font-medium">Feedback request</span><span className="text-[12.5px] text-muted">One message after a purchase, at most once a month per customer.</span></span></label>
          {p.feedback ? (
            <div className="flex gap-2 items-center flex-wrap pl-7 text-[12.5px] text-muted">
              Template <select value={p.feedbackTemplate} onChange={(e) => save({ feedbackTemplate: e.target.value })} aria-label="Feedback template" className={sel}>{tplOptions(p.feedbackTemplate)}</select>
              <select value={p.feedbackHours} onChange={(e) => save({ feedbackHours: Number(e.target.value) })} aria-label="Hours after purchase" className={sel}>{[1, 2, 4, 8, 24, 48].map((h) => <option key={h} value={h}>{h} h after purchase</option>)}</select>
              <span className="text-faint">{"{{1}}"} name · {"{{2}}"} invoice no.</span>
            </div>
          ) : null}
          <label className="flex gap-3 cursor-pointer items-start"><input type="checkbox" className="accent-teal size-4 mt-1 flex-none" checked={p.payment} onChange={(e) => toggle("payment", e.target.checked)} /><span className="flex flex-col"><span className="text-[14px] font-medium">Weekly payment reminders</span><span className="text-[12.5px] text-muted">To customers with a credit balance who consented, once a week from 10:00 (never twice within 6 days).</span></span></label>
          {p.payment ? (
            <div className="flex gap-2 items-center flex-wrap pl-7 text-[12.5px] text-muted">
              Template <select value={p.paymentTemplate} onChange={(e) => save({ paymentTemplate: e.target.value })} aria-label="Payment reminder template" className={sel}>{tplOptions(p.paymentTemplate)}</select>
              <select value={p.paymentDay} onChange={(e) => save({ paymentDay: Number(e.target.value) })} aria-label="Reminder day" className={sel}>{DAYS.map((d, i) => <option key={d} value={i}>Every {d}</option>)}</select>
              <span className="text-faint">{"{{1}}"} name · {"{{2}}"} amount due · {"{{3}}"} pharmacy</span>
            </div>
          ) : null}
        </div>
        {dues.length ? (
          <div className={card}>
            <div className="flex items-center justify-between gap-2"><div className="font-semibold text-[15px]">Credit dues</div>{reach ? <Button size="sm" disabled={pending} onClick={remindAll}>Remind all now</Button> : null}</div>
            {dues.slice(0, 12).map((d) => (
              <div key={d.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 py-1 border-b border-row last:border-0 text-[13.5px]">
                <strong className="font-semibold flex-1 min-w-[120px] truncate">{d.name}</strong>
                <span className="tnum font-semibold text-bad">{inr0(d.due)}</span>
                <Badge tone={d.wa ? "green" : d.sms ? "blue" : "gray"}>{d.wa ? "WhatsApp" : d.sms ? "SMS" : "No consent"}</Badge>
                {d.lastReminder ? <span className="text-[12px] text-faint sm:w-[92px] text-right">reminded {dayMonth(new Date(d.lastReminder))}</span> : null}
              </div>
            ))}
            <div className="text-[12px] text-faint">One reminder per customer a day. Customers without consent are skipped. Remind one customer from Suppliers & customers.</div>
          </div>
        ) : null}
        {p.refill ? (
          <div className={card}>
            <div className="flex items-center justify-between gap-2"><div className="font-semibold text-[15px]">Upcoming refill reminders</div>{reach ? <Button size="sm" disabled={pending} onClick={sendRefills}>Send due now</Button> : null}</div>
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
              <div className="flex flex-col flex-1 min-w-0"><strong className="font-semibold">{c.name}</strong><span className="text-[12px] text-faint">{c.message ? `Store update: “${c.message.slice(0, 60)}${c.message.length > 60 ? "…" : ""}” · ` : ""}{c.template} · {c.audience} opted in · {dayMonth(new Date(c.createdAt))}</span></div>
              <Badge tone={c.status === "sent" ? "green" : c.status === "draft" ? "blue" : c.status === "failed" ? "red" : "amber"}>{c.status === "sent" ? `Sent · ${c.delivered} delivered${c.failed ? ` · ${c.failed} failed` : ""}` : c.status === "sending" || c.status === "failed" ? `${c.status === "failed" ? "Stopped" : "Sending"} · ${c.handled} of ~${c.audience}` : c.status}</Badge>
              {c.status === "draft" && reach ? <Button size="sm" variant="primary" disabled={pending} onClick={() => send(c)}>Send</Button> : null}
              {(c.status === "sending" || c.status === "failed") && reach ? <Button size="sm" disabled={pending} onClick={() => send(c)}>Resume</Button> : null}
            </div>
          ))}
          {reach ? (
            <div className="flex flex-col gap-2">
              <div className="flex gap-2 flex-wrap">
                <input value={name} onChange={(e) => setName(e.target.value)} placeholder="New campaign or store update name" className="border border-input rounded-lg px-3 py-2 text-[13.5px] flex-1 min-w-[180px] outline-none focus:border-teal" />
                <select value={tpl} onChange={(e) => setTpl(e.target.value)} aria-label="Template" className="border border-input rounded-lg px-2 text-[13px] bg-white">{templates.length ? templates.map((x) => <option key={x}>{x}</option>) : <option value="">{connected ? "No approved templates" : "store_update (SMS only)"}</option>}</select>
              </div>
              <textarea value={msg} onChange={(e) => setMsg(e.target.value)} maxLength={300} rows={2} placeholder="Store update text, e.g. “Open 9 to 2 on Diwali.” Sent as {{2}} after the name; leave empty for a plain campaign." aria-label="Store update text" className="border border-input rounded-lg px-3 py-2 text-[13.5px] outline-none focus:border-teal resize-y" />
              <Button className="self-start" disabled={pending || (!tpl && connected)} onClick={() => start(async () => { const r = await draftAction(name, tpl || "store_update", msg); toast(r.ok ? r.message! : r.error, r.ok ? "green" : "red"); if (r.ok) { setName(""); setMsg(""); } })}>Save draft</Button>
            </div>
          ) : <div className="text-[13px] text-muted">Connect WhatsApp Business (or turn on SMS) to create campaigns.</div>}
          <div className="text-[12px] text-faint">Sends only to customers who consented: on WhatsApp through templates approved by Meta, otherwise by SMS if they agreed to it. Customers can reply STOP to opt out at any time.</div>
        </div>
        <div className={card}>
          <div className="flex items-center justify-between"><div className="font-semibold text-[15px]">SMS</div><Badge tone={smsOn ? "green" : "gray"}>{!sms.available ? "Not set up" : sms.enabled ? "On" : "Off"}</Badge></div>
          <label className="flex gap-3 cursor-pointer items-start"><input type="checkbox" className="accent-teal size-4 mt-1 flex-none" checked={sm.enabled} disabled={!sms.available || pending} onChange={(e) => { const on = e.target.checked; setSm({ ...sm, enabled: on }); start(async () => { const r = await smsAction({ enabled: on }); if (!r.ok) toast(r.error, "red"); }); }} />
            <span className="flex flex-col"><span className="text-[14px] font-medium">Send by SMS when a customer has no WhatsApp consent</span><span className="text-[12.5px] text-muted">Only to customers who agreed to SMS, through your SMS provider. Indian DLT rules apply: every message type needs a DLT-approved template.</span></span></label>
          {sm.enabled ? (
            <div className="grid grid-cols-[1fr_170px] gap-x-3 gap-y-1.5 items-center pl-7 text-[13px]">
              {(Object.keys(SMS_LABEL) as SmsType[]).map((k) => (
                <div key={k} className="contents"><span className="text-muted">{SMS_LABEL[k]}</span><input value={sm.templates[k] ?? ""} onChange={(e) => setSm({ ...sm, templates: { ...sm.templates, [k]: e.target.value } })} placeholder={sms.needsTemplate ? "Template id (required)" : "DLT template id"} aria-label={`${SMS_LABEL[k]} template id`} className="border border-input rounded-md px-2 py-1 font-mono text-[12.5px]" /></div>
              ))}
              <Button size="sm" className="col-span-full justify-self-start" disabled={pending} onClick={() => start(async () => { const r = await smsAction({ templates: sm.templates }); toast(r.ok ? r.message! : r.error, r.ok ? "green" : "red"); })}>Save template ids</Button>
              <span className="col-span-full text-[12px] text-faint">{sms.needsTemplate ? "MSG91: the Flow template id linked to your DLT template, with ##var1##, ##var2##… in the same order as the WhatsApp variables." : "The DLT template id goes to your gateway with the message; the registered text must match Medoro’s wording."}</span>
            </div>
          ) : null}
        </div>
        <div className={card}>
          <div className="flex items-center justify-between"><div className="font-semibold text-[15px]">Loyalty points</div><Badge tone={loyalty.enabled ? "green" : "gray"}>{loyalty.enabled ? "On" : "Off"}</Badge></div>
          <label className="flex gap-3 cursor-pointer items-start"><input type="checkbox" className="accent-teal size-4 mt-1 flex-none" checked={ly.enabled} disabled={pending} onChange={(e) => { setLy({ ...ly, enabled: e.target.checked }); saveLoyalty({ enabled: e.target.checked }); }} />
            <span className="flex flex-col"><span className="text-[14px] font-medium">Customers earn points on every bill</span><span className="text-[12.5px] text-muted">Earned on the amount paid and redeemed at Billing as part payment. The invoice and its GST stay as billed; the redeemed value is booked to “Loyalty points redeemed”.</span></span></label>
          {ly.enabled ? (
            <div className="grid grid-cols-[1fr_110px] gap-x-3 gap-y-1.5 items-center pl-7 text-[13px]">
              <span className="text-muted">Points per ₹100 paid</span><input value={ly.earnPer100} onChange={(e) => setLy({ ...ly, earnPer100: e.target.value })} inputMode="decimal" aria-label="Points per 100 rupees" className="border border-input rounded-md px-2 py-1 text-right" />
              <span className="text-muted">Value of 1 point (₹)</span><input value={ly.pointValue} onChange={(e) => setLy({ ...ly, pointValue: e.target.value })} inputMode="decimal" aria-label="Point value" className="border border-input rounded-md px-2 py-1 text-right" />
              <span className="text-muted">Minimum points to redeem</span><input value={ly.minRedeem} onChange={(e) => setLy({ ...ly, minRedeem: e.target.value })} inputMode="numeric" aria-label="Minimum redemption" className="border border-input rounded-md px-2 py-1 text-right" />
              <span className="text-muted">Expire after months (0 never)</span><input value={ly.expiryMonths} onChange={(e) => setLy({ ...ly, expiryMonths: e.target.value })} inputMode="numeric" aria-label="Expiry months" className="border border-input rounded-md px-2 py-1 text-right" />
              <label className="col-span-full flex gap-2 items-center cursor-pointer flex-wrap"><input type="checkbox" className="accent-teal size-4 flex-none" checked={ly.notify} onChange={(e) => setLy({ ...ly, notify: e.target.checked })} />Message customers the points they earn
                {ly.notify ? <select value={ly.template} onChange={(e) => setLy({ ...ly, template: e.target.value })} aria-label="Points template" className={sel}>{tplOptions(ly.template)}</select> : null}</label>
              {ly.notify ? <span className="col-span-full text-[12px] text-faint">{"{{1}}"} name · {"{{2}}"} points earned · {"{{3}}"} balance. WhatsApp or SMS, only with consent.</span> : null}
              <Button size="sm" className="col-span-full justify-self-start" disabled={pending} onClick={() => saveLoyalty({ earnPer100: Number(ly.earnPer100), pointValuePaise: Math.round(parseFloat(ly.pointValue) * 100), minRedeem: Number(ly.minRedeem), expiryMonths: Number(ly.expiryMonths), notify: ly.notify, template: ly.template })}>Save loyalty settings</Button>
            </div>
          ) : null}
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
