"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import { MessageCircle, RefreshCw, Copy, CircleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, type Tone } from "@/components/ui/badge";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { dayMonth, hhmm } from "@/lib/dates";
import type { messageLog, waStatus, WaSettings } from "@/domain/comms/whatsapp";
import { connectAction, disconnectAction, retryAction, settingsAction, signupAction, templatesAction } from "./actions";

const card = "bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] p-4 flex flex-col gap-3";
const ST: Record<string, Tone> = { queued: "gray", sent: "blue", delivered: "teal", read: "green", failed: "red", approved: "green", pending: "amber", rejected: "red", paused: "amber", disabled: "red" };

type Fb = { init(o: object): void; login(cb: (r: { authResponse?: { code?: string } | null }) => void, o: object): void };
declare global { interface Window { FB?: Fb; fbAsyncInit?: () => void } }
type Signup = { appId: string; configId: string; version: string } | null;
type Session = { waba_id?: string; phone_number_id?: string };

/** Loads Meta's JavaScript SDK once, so the Embedded Signup popup can open straight from the click. */
function useFacebookSdk(cfg: Signup) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (!cfg) return;
    if (window.FB) { setReady(true); return; }
    window.fbAsyncInit = () => { window.FB!.init({ appId: cfg.appId, autoLogAppEvents: true, xfbml: true, version: cfg.version }); setReady(true); };
    if (document.getElementById("facebook-jssdk")) return;
    const s = document.createElement("script");
    s.id = "facebook-jssdk"; s.src = "https://connect.facebook.net/en_US/sdk.js"; s.async = true; s.defer = true; s.crossOrigin = "anonymous";
    document.body.appendChild(s);
  }, [cfg]);
  return ready;
}

export function WhatsAppView({ st, log, settings, invoiceTemplate, signup, webhook }: {
  st: Awaited<ReturnType<typeof waStatus>>; log: Awaited<ReturnType<typeof messageLog>>; settings: WaSettings;
  invoiceTemplate: { name: string; ok: boolean; error: string | null }; signup: Signup; webhook: string;
}) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [form, setForm] = useState(!st.connected && !signup);
  const [f, setF] = useState({ wabaId: st.connected ? st.cfg.wabaId : "", phoneNumberId: st.connected ? st.cfg.phoneNumberId : "", token: "", appSecret: "", invoiceTemplate: st.connected ? st.cfg.invoiceTemplate : "invoice_share", templateLang: st.connected ? st.cfg.templateLang : "en" });
  const [s, setS] = useState(settings);
  const [names, setNames] = useState({ textTemplate: settings.textTemplate, creditNoteTemplate: settings.creditNoteTemplate });
  const session = useRef<Session>({});
  const sdk = useFacebookSdk(signup);
  const res = (r: { ok: true; message?: string } | { ok: false; error: string }) => toast(r.ok ? r.message ?? "Done." : r.error, r.ok ? "green" : "red");
  const copy = (x: string) => { navigator.clipboard.writeText(x); toast("Copied.", "gray"); };
  const paused = st.connected && !!st.cfg.disconnected;
  const live = st.connected && !paused;

  // Embedded Signup reports the new WABA and phone number IDs through a message from facebook.com.
  useEffect(() => {
    const on = (e: MessageEvent) => {
      let host = "";
      try { host = new URL(e.origin).hostname; } catch { return; }
      if (host !== "facebook.com" && !host.endsWith(".facebook.com")) return;
      try {
        const d = typeof e.data === "string" ? JSON.parse(e.data) : e.data;
        if (d?.type !== "WA_EMBEDDED_SIGNUP") return;
        if (String(d.event).startsWith("FINISH")) session.current = d.data ?? {};
        else if (d.event === "CANCEL") toast(`Signup stopped at ${String(d.data?.current_step ?? "a step").toLowerCase().replace(/_/g, " ")}.`, "amber");
        else if (d.event === "ERROR") toast(`Meta reported an error: ${d.data?.error_message ?? "unknown"}`, "red");
      } catch { /* other facebook.com messages */ }
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, [toast]);

  const launch = () => {
    if (!signup || !window.FB) return toast("Facebook is still loading. Try again in a moment.", "amber");
    session.current = {};
    window.FB.login((r) => {
      const code = r.authResponse?.code;
      if (!code) return toast("Signup was closed before it finished.", "amber");
      start(async () => {
        // The code is valid for 30 seconds; the session event can arrive just after it.
        for (let i = 0; i < 10 && !session.current.waba_id; i++) await new Promise((ok) => setTimeout(ok, 200));
        const out = await signupAction({ code, wabaId: session.current.waba_id, phoneNumberId: session.current.phone_number_id });
        if (!out.ok) return toast(out.error, "red");
        setForm(false);
        toast(out.data.length ? `Connected. ${out.data.join(" ")}` : "WhatsApp connected through Meta. Delivery updates will arrive on this server.", out.data.length ? "amber" : "green");
      });
    }, { config_id: signup.configId, response_type: "code", override_default_response_type: true, extras: { setup: {} } });
  };
  const save = (p: Partial<WaSettings>) => { setS({ ...s, ...p }); start(async () => res(await settingsAction(p))); };
  const fbButton = (label: string) => signup ? <Button variant="primary" disabled={pending || !sdk} onClick={launch}>{label}</Button> : null;

  return (
    <div className="flex flex-col gap-4 max-w-[1300px]">
      {paused ? (
        <div role="alert" className="border border-[#E5B4AE] bg-bad-bg rounded-xl px-4 py-3 flex flex-wrap items-center gap-3 text-[13.5px] text-bad">
          <CircleAlert size={18} />
          <span className="flex-1 min-w-[240px]"><strong className="font-semibold">Disconnected by Meta</strong> since {dayMonth(new Date(st.cfg.disconnected!.at))} {hhmm(new Date(st.cfg.disconnected!.at))}: {st.cfg.disconnected!.reason}. Invoices and reminders are paused and resume after you reconnect.</span>
          {fbButton("Reconnect with Facebook")}
          <Button onClick={() => setForm(true)}>Paste a new token</Button>
        </div>
      ) : null}
      <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))]">
        <div className={card}>
          <div className="flex items-center gap-2"><MessageCircle size={20} className="text-ok" /><div className="font-semibold text-[15px]">WhatsApp Business Cloud API</div><Badge tone={live ? "green" : paused ? "red" : "gray"} className="ml-auto">{live ? "Connected" : paused ? "Reconnect needed" : "Not connected"}</Badge></div>
          {st.connected && !form ? (
            <>
              <div className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-1.5 text-[13.5px]">
                <span className="text-muted">Display number</span><span>{st.cfg.displayPhone}{st.cfg.verifiedName ? ` · ${st.cfg.verifiedName}` : ""}</span>
                <span className="text-muted">WABA ID</span><span className="font-mono text-[12.5px]">{st.cfg.wabaId}</span>
                <span className="text-muted">Phone number ID</span><span className="font-mono text-[12.5px]">{st.cfg.phoneNumberId}</span>
                <span className="text-muted">Access token</span><span>Sealed on this server{st.rotatedAt ? ` · set ${dayMonth(new Date(st.rotatedAt), true)}` : ""}{st.cfg.via === "embedded" ? " · from Embedded Signup" : ""} · never sent to browsers</span>
                <span className="text-muted">Webhook</span><span className="flex flex-col gap-1"><span className="flex items-center gap-1.5"><span className="font-mono text-[12px] break-all">{webhook}</span><button onClick={() => copy(webhook)} aria-label="Copy URL" className="text-faint cursor-pointer"><Copy size={13} /></button></span>
                  <span className="flex items-center gap-1.5 text-[12.5px]">Verify token <span className="font-mono">{st.cfg.verifyToken}</span><button onClick={() => copy(st.cfg.verifyToken)} aria-label="Copy token" className="text-faint cursor-pointer"><Copy size={13} /></button></span>
                  <Badge tone={st.cfg.webhookVerified ? "green" : "amber"} className="self-start">{st.cfg.webhookVerified ? "Verified by Meta" : "Not verified yet"}</Badge></span>
              </div>
              {st.cfg.registerError ? <div className="text-[12.5px] text-bad">Phone number not registered for Cloud API: {st.cfg.registerError}. Fix it in WhatsApp Manager, then reconnect.</div> : null}
              <div className="flex gap-2 flex-wrap">{paused ? null : fbButton("Reconnect with Facebook")}<Button onClick={() => setForm(true)}>Rotate token</Button><Button variant="danger-outline" disabled={pending} onClick={() => { if (confirm("Disconnect WhatsApp? The token is deleted from this server.")) start(async () => res(await disconnectAction())); }}>Disconnect</Button></div>
            </>
          ) : !form ? (
            <>
              <div className="text-[13px] text-muted">Connect with Meta’s Embedded Signup: log in with Facebook, pick or create your WhatsApp Business account and phone number, and Medoro finishes the setup (token, webhooks, number registration). You need a Meta Business account and a number not already on the WhatsApp app.</div>
              <div className="flex gap-2 flex-wrap">{fbButton("Connect with Facebook")}<Button variant="ghost" onClick={() => setForm(true)}>Enter credentials manually</Button></div>
            </>
          ) : (
            <>
              <div className="text-[13px] text-muted">You need a verified Meta Business account, a WhatsApp Business API phone number, a system-user access token and your Meta app secret. Medoro checks them with Meta before saving them sealed on this server.</div>
              <div className="grid grid-cols-2 gap-2.5 max-sm:grid-cols-1">
                <Field label="WABA ID"><Input value={f.wabaId} onChange={(e) => setF({ ...f, wabaId: e.target.value })} className="font-mono" /></Field>
                <Field label="Phone number ID"><Input value={f.phoneNumberId} onChange={(e) => setF({ ...f, phoneNumberId: e.target.value })} className="font-mono" /></Field>
                <Field label="Access token" className="col-span-full"><Input type="password" value={f.token} onChange={(e) => setF({ ...f, token: e.target.value })} autoComplete="off" /></Field>
                <Field label="App secret"><Input type="password" value={f.appSecret} onChange={(e) => setF({ ...f, appSecret: e.target.value })} autoComplete="off" /></Field>
                <Field label="Invoice template" hint="Approved template with a document header and 3 body variables: name, invoice no, amount."><Input value={f.invoiceTemplate} onChange={(e) => setF({ ...f, invoiceTemplate: e.target.value })} className="font-mono" /></Field>
              </div>
              <div className="flex gap-2">
                <Button variant="primary" disabled={pending} onClick={() => start(async () => { const r = await connectAction(f); res(r); if (r.ok) { setForm(false); setF({ ...f, token: "", appSecret: "" }); } })}>{st.connected ? "Save new token" : "Verify & connect"}</Button>
                {st.connected || signup ? <Button onClick={() => setForm(false)}>Cancel</Button> : null}
              </div>
            </>
          )}
        </div>
        <div className={card}>
          <div className="font-semibold text-[15px]">Invoice delivery</div>
          <label className="flex gap-3 cursor-pointer items-start"><input type="checkbox" className="accent-teal size-4 mt-1" checked={s.auto} disabled={!st.connected || pending} onChange={(e) => save({ auto: e.target.checked })} /><span className="flex flex-col"><span className="text-[14px] font-medium">Auto-send after sale</span><span className="text-[12.5px] text-muted">Only for customers with recorded WhatsApp consent whose number isn’t flagged. Others still need the cashier to confirm the number.</span></span></label>
          <label className="flex gap-3 cursor-pointer items-start"><input type="checkbox" className="accent-teal size-4 mt-1" checked={s.pdf} disabled={pending} onChange={(e) => save({ pdf: e.target.checked })} /><span className="flex flex-col"><span className="text-[14px] font-medium">Attach the invoice PDF</span><span className="text-[12.5px] text-muted">{s.pdf ? <>The PDF is uploaded to WhatsApp and sent as the document header of <span className="font-mono">{st.connected ? st.cfg.invoiceTemplate : "invoice_share"}</span>.</> : <>Text-only template; its 4th variable is a link to the PDF on this server that works for 7 days.</>}</span></span></label>
          {!s.pdf ? (
            <div className="flex gap-2 items-end pl-7">
              <Field label="Text-only invoice template" hint="Body: name, invoice no., amount, link."><Input value={names.textTemplate} onChange={(e) => setNames({ ...names, textTemplate: e.target.value })} className="font-mono" /></Field>
              <Button size="sm" disabled={pending || names.textTemplate === s.textTemplate} onClick={() => save({ textTemplate: names.textTemplate })}>Save</Button>
            </div>
          ) : null}
          {st.connected ? (invoiceTemplate.ok
            ? <div className="text-[12.5px] text-ok">Template <span className="font-mono">{invoiceTemplate.name}</span> is approved{s.auto ? "; auto-send is active" : ""}.</div>
            : <div role="alert" className="text-[12.5px] text-bad flex gap-1.5"><CircleAlert size={14} className="mt-0.5 flex-none" /><span>{invoiceTemplate.error}{s.auto ? " Auto-send is paused until it’s approved." : " Invoices can’t be sent until then."}</span></div>) : null}
          <div className="flex gap-2 items-end">
            <Field label="Credit note template" hint="Sent from Returns. Body: name, credit note no., amount, invoice no."><Input value={names.creditNoteTemplate} onChange={(e) => setNames({ ...names, creditNoteTemplate: e.target.value })} className="font-mono" /></Field>
            <Button size="sm" disabled={pending || names.creditNoteTemplate === s.creditNoteTemplate} onClick={() => save({ creditNoteTemplate: names.creditNoteTemplate })}>Save</Button>
          </div>
          <div className="flex items-center justify-between pt-1"><div className="text-[12.5px] text-muted font-medium">Message templates</div>{st.connected ? <Button size="sm" disabled={pending} onClick={() => start(async () => { const r = await templatesAction(); toast(r.ok ? `${r.data} templates synced from Meta.` : r.error, r.ok ? "green" : "red"); })}><RefreshCw size={13} />Sync</Button> : null}</div>
          {st.connected && st.cfg.templates.length ? st.cfg.templates.map((t) => (
            <div key={t.name + t.language} className="flex items-center gap-2 text-[13px] py-1 border-b border-row last:border-0"><span className="font-mono">{t.name}</span><span className="text-faint">{t.language} · {t.category}{t.header ? ` · ${t.header.toLowerCase()} header` : ""}</span><Badge tone={ST[t.status] ?? "gray"} className="ml-auto">{t.status}</Badge></div>
          )) : <div className="text-[13px] text-fainter">{st.connected ? "No templates synced yet." : "Connect to see your approved templates."}</div>}
        </div>
      </div>
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        {[["Sent today", log.counts.sent], ["Delivered", log.counts.delivered], ["Read", log.counts.read], ["Failed", log.counts.failed]].map(([k, v]) => <div key={k} className="bg-white border border-line rounded-xl px-4 py-3 flex flex-col"><span className="text-[12.5px] text-muted">{k}</span><span className="text-[22px] font-semibold tnum">{v}</span></div>)}
      </div>
      <div className="bg-white border border-line rounded-xl overflow-auto">
        <div className="font-semibold text-[15px] px-4 pt-3.5 pb-2">Delivery log</div>
        {log.rows.length ? (
          <table className="w-full border-collapse min-w-[860px] text-[13.5px]">
            <thead><tr className="bg-subtle">{["Time", "Message", "Recipient", "Status", "Attempts", ""].map((x) => <th key={x} className="text-left text-[12px] font-medium text-muted px-3.5 py-2.5 border-b border-[#E3E6E9]">{x}</th>)}</tr></thead>
            <tbody>
              {log.rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-3.5 py-2.5 border-b border-row whitespace-nowrap">{dayMonth(new Date(r.at))} {hhmm(new Date(r.at))}</td>
                  <td className="px-3.5 py-2.5 border-b border-row"><div className="font-mono text-[12.5px]">{r.invoiceNo}</div><div className="text-[11.5px] text-faint">{r.kind}{r.channel === "sms" ? " · SMS" : ""}</div></td>
                  <td className="px-3.5 py-2.5 border-b border-row tnum">{r.to.slice(0, 5)} {r.to.slice(5)}</td>
                  <td className="px-3.5 py-2.5 border-b border-row"><Badge tone={ST[r.status]}>{r.status}</Badge>{r.error ? <div className="text-[12px] text-bad mt-0.5">{r.error}</div> : null}
                    {r.status === "failed" ? <div className="text-[11.5px] text-faint mt-0.5">{r.errorKind === "auth" ? "Waiting for WhatsApp to be reconnected" : r.nextAttemptAt && r.retryable ? `Retries automatically at ${hhmm(new Date(r.nextAttemptAt))}` : r.retryable ? "" : r.errorKind === "invalid" ? "Not retried: fix the number on the customer" : "Not retried: permanent failure"}</div> : null}</td>
                  <td className="px-3.5 py-2.5 border-b border-row tnum">{r.attempts}</td>
                  <td className="px-3.5 py-2.5 border-b border-row text-right">{r.status === "failed" && r.retryable && (r.channel === "sms" || live) ? <Button size="sm" disabled={pending} onClick={() => start(async () => res(await retryAction(r.id)))}>Retry</Button> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="px-4 pb-4 text-[13px] text-fainter">No messages yet. Invoices sent from Billing show here with their delivery status.</div>}
      </div>
    </div>
  );
}
