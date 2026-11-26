"use client";
import { useState } from "react";
import Link from "next/link";
import type { Data } from "@/staff/hrms/screens";
import { saveWhatsAppAlerts, sendWhatsAppTest, setMyWhatsAppAlerts } from "../actions";
import { Card, Field, Grid, Pill, btnCls, cx, inputCls, primaryCls, useRun } from "./kit";

/** Super admin, on Settings: switch HRMS alerts on WhatsApp on or off and name the approved template. */
export function WaAdminCard({ d }: { d: Data<"settings">["wa"] }) {
  const { run, busy } = useRun();
  const [c, setC] = useState(d.cfg);
  const week = d.week;
  return <Card title="WhatsApp alerts" sub="A copy of HRMS alerts (leave, claims, tasks, reviews…) on WhatsApp, for employees who switch it on in their profile" pad
    right={d.connected ? <Pill tone="green">Number connected{d.number ? ` · ${d.number}` : ""}</Pill> : <Pill tone="amber">Number not connected</Pill>}>
    {!d.connected ? <p className="text-[13px] text-[#94570A] mb-3">Connect the company WhatsApp Business number once in <Link className="font-semibold underline" href="/staff/growth/integrations">Growth → Integrations</Link> (the official WhatsApp Cloud API). The same number sends these alerts.</p> : null}
    <label className="flex items-center gap-2 text-[13.5px] py-1"><input type="checkbox" checked={c.enabled} onChange={(e) => setC({ ...c, enabled: e.target.checked })} />Send HRMS alerts on WhatsApp</label>
    <Grid n={2}>
      <Field label="Approved template name" hint="A Utility template with one variable, e.g. “Medoro HRMS: {{1}}”"><input className={inputCls} value={c.template} onChange={(e) => setC({ ...c, template: e.target.value })} /></Field>
      <Field label="Template language code"><input className={cx(inputCls, "!w-32")} value={c.lang} onChange={(e) => setC({ ...c, lang: e.target.value })} /></Field>
    </Grid>
    <p className="text-[12.5px] text-[#64748B] mt-2">{d.optedIn} employee{d.optedIn === 1 ? "" : "s"} switched it on. Last 7 days: {week.sent ?? 0} sent, {week.pending ?? 0} waiting, {week.failed ?? 0} failed.{d.lastError ? ` Last error: ${d.lastError.error}` : ""}</p>
    <div className="flex gap-2 mt-3 flex-wrap">
      <button type="button" className={primaryCls} disabled={busy} onClick={() => run(() => saveWhatsAppAlerts(c))}>Save WhatsApp settings</button>
      <button type="button" className={btnCls} disabled={busy || !d.connected} onClick={() => run(() => sendWhatsAppTest(), (m) => m)}>Send a test to my phone</button>
    </div>
  </Card>;
}

/** The employee's own switch, on My Profile, once the company has WhatsApp alerts on. */
export function WaProfileCard({ d }: { d: Data<"profile">["wa"] }) {
  const { run, busy } = useRun();
  if (!d.available) return null;
  return <Card title="WhatsApp alerts" sub="Get a copy of your HR alerts on WhatsApp from Medoro’s business number. You can switch it off any time." pad>
    {d.phone ? <label className="flex items-center gap-2 text-[13.5px]"><input type="checkbox" checked={d.on} disabled={busy} onChange={(e) => run(() => setMyWhatsAppAlerts(e.target.checked))} />Send my HR alerts to {d.phone} on WhatsApp</label>
      : <p className="text-[13px] text-[#64748B]">Add your mobile number below to get alerts on WhatsApp.</p>}
  </Card>;
}
