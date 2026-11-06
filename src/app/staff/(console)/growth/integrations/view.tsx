"use client";
import { useState } from "react";
import { connectWhatsApp, disconnect, retryJob, runJobsNow } from "../../../growth-actions";
import { Empty, Panel, Pill, btn, btnPrimary, fieldCls, lbl, td, th, useRun } from "../../ui";
import { fmtDT } from "../kit";

type J = { id: string; kind: string; status: string; attempts: number; maxAttempts: number; runAt: string; lastError: string | null; createdAt: string };
type I = { whatsapp: { status: string; config: Record<string, string>; verifyToken: string | null; lastError: string | null } | null; email: { status: string } | null; mailProvider: string };
const ST: Record<string, [string, string]> = { done: ["#E3F5EC", "#18794E"], queued: ["#EAF0FC", "#2459C9"], running: ["#E1F1EF", "#0B5E5B"], failed: ["#FFF4E0", "#94570A"], dead: ["#FBEAE9", "#C0362C"] };

export function IntegrationsView({ i, jobs, webhook, osm, ai, emailWebhook }: { i: I; jobs: J[]; webhook: string; osm: { enabled: boolean; host: string }; ai: { mode: string; note: string }; emailWebhook: boolean }) {
  const { run, busy } = useRun();
  const [f, setF] = useState({ phoneNumberId: "", wabaId: "", token: "", appSecret: "" });
  const w = i.whatsapp;
  return (
    <>
      <Panel title="WhatsApp Business Platform" sub="Medoro’s own platform number for prospecting. Separate from any pharmacy’s WhatsApp; credentials are encrypted on the server.">
        {w?.status === "connected" ? (
          <div className="p-4 text-[13.5px] flex flex-col gap-1.5">
            <span>Connected · {w.config.displayNumber || w.config.phoneNumberId} · WABA {w.config.wabaId}</span>
            <span>Webhook URL for the Meta app: <code className="bg-[#F5F6F7] px-1 rounded">{webhook}</code></span>
            <span>Verify token: <code className="bg-[#F5F6F7] px-1 rounded">{w.verifyToken}</code> · subscribe to <em>messages</em> and <em>message_template_status_update</em>.</span>
            <button className={btn + " self-start mt-1"} disabled={busy} onClick={() => run(() => disconnect("whatsapp"))}>Disconnect</button>
          </div>
        ) : (
          <form className="grid gap-2.5 p-4 grid-cols-1 min-[900px]:grid-cols-2" onSubmit={(e) => { e.preventDefault(); run(() => connectWhatsApp(f), () => setF({ phoneNumberId: "", wabaId: "", token: "", appSecret: "" })); }}>
            <label className={lbl}>Phone number ID<input className={fieldCls} value={f.phoneNumberId} onChange={(e) => setF({ ...f, phoneNumberId: e.target.value })} /></label>
            <label className={lbl}>WhatsApp Business Account ID<input className={fieldCls} value={f.wabaId} onChange={(e) => setF({ ...f, wabaId: e.target.value })} /></label>
            <label className={lbl}>Permanent access token (system user)<input type="password" autoComplete="off" className={fieldCls} value={f.token} onChange={(e) => setF({ ...f, token: e.target.value })} /></label>
            <label className={lbl}>App secret (for webhook signatures)<input type="password" autoComplete="off" className={fieldCls} value={f.appSecret} onChange={(e) => setF({ ...f, appSecret: e.target.value })} /></label>
            <div><button className={btnPrimary} disabled={busy}>Connect and check with Meta</button></div>
          </form>
        )}
      </Panel>
      <div className="grid gap-4 min-[1000px]:grid-cols-3">
        <Panel title="Email"><div className="p-4 text-[13.5px]">Provider: {i.mailProvider || "not configured"} · sender {i.email?.status ?? "not set up"}<div className="text-muted text-[12.5px] mt-1">Events webhook {emailWebhook ? "enabled" : "off (set GROWTH_EMAIL_WEBHOOK_SECRET)"}.</div></div></Panel>
        <Panel title="OpenStreetMap"><div className="p-4 text-[13.5px]">{osm.enabled ? `On · ${osm.host}` : "Off (GROWTH_OSM=off)"}<div className="text-muted text-[12.5px] mt-1">Open data under ODbL with attribution. No API key.</div></div></Panel>
        <Panel title="AI provider"><div className="p-4 text-[13.5px]">Mode: {ai.mode === "rules" ? "rule-based (no paid API)" : ai.mode}<div className="text-muted text-[12.5px] mt-1">{ai.note || "Uses the app’s AI_MODE settings; remote models need GROWTH_REMOTE_AI=1."}</div></div></Panel>
      </div>
      <Panel title="Background jobs" sub="Imports, discovery, campaign batches, escalations and roll-ups. Failed jobs retry with backoff; after the last attempt they are dead until retried." right={<button className={btn} disabled={busy} onClick={() => run(() => runJobsNow(), (r) => `${r.ran} job(s) run, ${r.failed} failed.`)}>Run due jobs now</button>}>
        {jobs.length ? (
          <div className="overflow-auto"><table className="w-full border-collapse min-w-[760px] text-[13px]">
            <thead><tr className="bg-[#FAFBFB] text-muted text-[12px]"><th className={th}>Job</th><th className={th}>Status</th><th className={th}>Attempts</th><th className={th}>Next run</th><th className={th}>Last error</th><th className={th}></th></tr></thead>
            <tbody>{jobs.map((j) => <tr key={j.id}><td className={td}>{j.kind}<div className="text-muted text-[11.5px]">{fmtDT(j.createdAt)}</div></td><td className={td}><Pill bg={(ST[j.status] ?? ST.queued)[0]} fg={(ST[j.status] ?? ST.queued)[1]}>{j.status}</Pill></td><td className={td}>{j.attempts}/{j.maxAttempts}</td><td className={td}>{fmtDT(j.runAt)}</td><td className={td + " max-w-[360px] text-[12px]"}>{j.lastError}</td><td className={td}>{["dead", "failed"].includes(j.status) ? <button className={btn} disabled={busy} onClick={() => run(() => retryJob(j.id))}>Retry</button> : null}</td></tr>)}</tbody>
          </table></div>
        ) : <Empty>No jobs yet.</Empty>}
      </Panel>
    </>
  );
}
