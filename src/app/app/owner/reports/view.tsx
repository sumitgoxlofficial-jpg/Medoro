"use client";
import { useState, useTransition } from "react";
import { Mail, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/field";
import { Segmented } from "@/components/ui/segmented";
import { useActionToast, useToast } from "@/components/ui/toast";
import { dayMonth, hhmm } from "@/lib/dates";
import { MAIL_REPORTS, WEEKDAYS, type MailReportId } from "@/domain/reports/mail-contracts";
import type { reportMailView } from "@/domain/reports/mailer";
import { saveReportMailAction, sendNowAction } from "./actions";

type View = Awaited<ReturnType<typeof reportMailView>>;

export function ReportMailForm({ initial, canEdit }: { initial: View; canEdit: boolean }) {
  const act = useActionToast();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [enabled, setEnabled] = useState(initial.enabled);
  const [frequency, setFrequency] = useState(initial.frequency);
  const [weekday, setWeekday] = useState(initial.weekday);
  const [time, setTime] = useState(initial.time);
  const [recipients, setRecipients] = useState(initial.recipients.join("\n"));
  const [reports, setReports] = useState<MailReportId[]>(initial.reports);
  const list = recipients.split(/[\s,;]+/).map((x) => x.trim()).filter(Boolean);
  const save = () => start(async () => { act(await saveReportMailAction({ enabled, frequency, weekday, time, recipients: list, reports })); });
  const now = () => start(async () => {
    const r = await sendNowAction();
    if (!r.ok) return void toast(r.error, "red");
    toast(r.data.ok ? `Sent: ${r.data.detail}` : r.data.detail, r.data.ok ? "green" : "red");
  });

  return (
    <div className="grid gap-4 max-w-[980px] grid-cols-[minmax(0,1.3fr)_minmax(260px,1fr)] max-[860px]:grid-cols-1 items-start">
      <Card className="p-5 flex flex-col gap-4">
        <Checkbox checked={enabled} disabled={!canEdit} onChange={(e) => setEnabled(e.target.checked)} label={<b>Send scheduled reports</b>} />
        <div className="flex gap-3 flex-wrap items-end">
          <Field label="How often"><Segmented value={frequency} onChange={(v) => canEdit && setFrequency(v)} options={[{ value: "daily", label: "Daily" }, { value: "weekly", label: "Weekly" }]} /></Field>
          {frequency === "weekly" ? <Field label="On"><Select value={weekday} disabled={!canEdit} onChange={(e) => setWeekday(Number(e.target.value))} className="w-[150px]">{WEEKDAYS.map((d, i) => <option key={d} value={i}>{d}</option>)}</Select></Field> : null}
          <Field label="At (India time)"><Input type="time" value={time} disabled={!canEdit} onChange={(e) => setTime(e.target.value)} className="w-[120px]" /></Field>
        </div>
        <div className="text-[12.5px] text-faint">{frequency === "daily" ? "Covers yesterday." : "Covers the 7 days before the send day."} Low stock, expiry and dues are as of sending.</div>
        <Field label="Reports">
          <div className="flex flex-col gap-1.5">{MAIL_REPORTS.map(([id, label]) => <Checkbox key={id} disabled={!canEdit} checked={reports.includes(id)} onChange={(e) => setReports((x) => e.target.checked ? [...x, id] : x.filter((y) => y !== id))} label={label} />)}</div>
        </Field>
        <Field label="Send to" hint="Up to 10 email addresses, one per line. Each email has its own unsubscribe link.">
          <Textarea value={recipients} disabled={!canEdit} onChange={(e) => setRecipients(e.target.value)} placeholder="owner@example.in&#10;ca@example.in" />
        </Field>
        {canEdit ? <div className="flex gap-2"><Button variant="primary" disabled={pending} onClick={save}>Save</Button><Button disabled={pending || !initial.recipients.length} onClick={now} title="Sends the current saved settings now"><Send size={14} />Send now</Button></div> : <div className="text-[12.5px] text-faint">Only the owner (Manage users permission) can change this.</div>}
      </Card>
      <Card className="p-5 flex flex-col gap-2 text-[13px]">
        <div className="flex items-center gap-2 font-semibold"><Mail size={16} className="text-teal" />Delivery</div>
        {!initial.mailReady ? <div className="text-bad">Email isn’t set up on this server. Set MAIL_PROVIDER and MAIL_FROM (see docs/DEPLOYMENT.md).</div> : <div className="text-muted">Email is set up on this server.</div>}
        {initial.last ? <div className={initial.last.ok ? "text-ok" : "text-bad"}>Last run {dayMonth(new Date(initial.last.at))} {hhmm(new Date(initial.last.at))}: {initial.last.detail}</div> : <div className="text-faint">Not sent yet.</div>}
        <div className="text-faint">Attachments are CSV files that open in Excel. Every send is recorded in the audit trail.</div>
      </Card>
    </div>
  );
}
