"use client";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n-client";
import { MessageCircle, RefreshCw, Copy, CircleAlert, Smartphone, LoaderCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, type Tone } from "@/components/ui/badge";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { dayMonth, hhmm } from "@/lib/dates";
import type { messageLog, waStatus, WaSettings } from "@/domain/comms/whatsapp";
import type { PhoneLink } from "@/domain/comms/whatsapp";
import { connectAction, disconnectAction, linkPhoneAction, retryAction, settingsAction, signupAction, templatesAction } from "./actions";

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

/**
 * "Link WhatsApp" by QR, like WhatsApp Web: asks the server every few seconds for the connector's state, shows the QR
 * code to scan from WhatsApp › Linked devices on the pharmacy phone, and closes once the phone is linked.
 */
function PhoneQr({ onDone, onClose }: { onDone: (number?: string) => void; onClose: () => void }) {
  const t = useT();
  const [st, setSt] = useState<PhoneLink | null>(null);
  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const r = await linkPhoneAction().catch(() => null);
      if (stop) return;
      const next: PhoneLink = r?.ok ? r.data : { state: "offline", text: r && !r.ok ? r.error : "Can’t reach the server. Checking again…" };
      if (next.state === "ready") return onDone(next.number);
      setSt(next);
      if (next.state !== "setup") timer = setTimeout(tick, next.state === "offline" ? 5000 : 2500);
    };
    void tick();
    return () => { stop = true; clearTimeout(timer); };
  }, [onDone]);
  return (
    <div className="flex flex-col gap-3 items-start">
      {st?.state === "qr" && st.qr ? (
        // eslint-disable-next-line @next/next/no-img-element -- a data URL from the connector, refreshed every few seconds
        <img src={st.qr} alt={t("WhatsApp QR code to scan")} width={240} height={240} className="border border-line rounded-lg bg-white p-2" />
      ) : st?.state === "setup" || st?.state === "offline" ? null : (
        <div className="w-[240px] h-[240px] border border-line rounded-lg flex items-center justify-center text-faint"><LoaderCircle size={28} className="animate-spin" /></div>
      )}
      <ol className="m-0 pl-5 text-[13px] text-muted list-decimal flex flex-col gap-0.5">
        <li>{t("Open WhatsApp on the pharmacy phone.")}</li>
        <li>{t("Tap")} <strong>⋮</strong> {t("(Android) or")} <strong>{t("Settings")}</strong> {t("(iPhone)")} › <strong>{t("Linked devices")}</strong> › <strong>{t("Link a device")}</strong>.</li>
        <li>{t("Point the phone at this code.")}</li>
      </ol>
      <div className={`text-[12.5px] ${st?.state === "setup" || st?.state === "offline" ? "text-bad" : "text-muted"}`} role="status">{st?.text ? t(st.text) : t("Starting WhatsApp…")}</div>
      <Button onClick={onClose}>Close</Button>
    </div>
  );
}

export function WhatsAppView({ st, log, settings, invoiceTemplate, signup, webhook, phoneLink }: {
  st: Awaited<ReturnType<typeof waStatus>>; log: Awaited<ReturnType<typeof messageLog>>; settings: WaSettings;
  invoiceTemplate: { name: string; ok: boolean; error: string | null }; signup: Signup; webhook: string; /** Why a phone can't be linked on this server, or null when it can. */ phoneLink: string | null;
}) {
  const toast = useToast(), t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const phone = st.connected && st.cfg.via === "phone";
  /** Connected through Meta (Embedded Signup or pasted credentials). */
  const meta = st.connected && !phone;
  const [form, setForm] = useState(!st.connected && !signup && !!phoneLink);
  const [qr, setQr] = useState(false);
  const [f, setF] = useState({ wabaId: meta ? st.cfg.wabaId : "", phoneNumberId: meta ? st.cfg.phoneNumberId : "", token: "", appSecret: "", invoiceTemplate: st.connected ? st.cfg.invoiceTemplate : "invoice_share", templateLang: st.connected ? st.cfg.templateLang : "en" });
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
        else if (d.event === "CANCEL") toast(t("Signup stopped at {step}.", { step: d.data?.current_step ? String(d.data.current_step).toLowerCase().replace(/_/g, " ") : t("a step") }), "amber");
        else if (d.event === "ERROR") toast(t("Meta reported an error: {error}", { error: d.data?.error_message ?? t("unknown") }), "red");
      } catch { /* other facebook.com messages */ }
    };
    window.addEventListener("message", on);
    return () => window.removeEventListener("message", on);
  }, [toast, t]);

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
        toast(out.data.length ? `${t("Connected.")} ${out.data.map((n) => t(n)).join(" ")}` : t("WhatsApp connected through Meta. Delivery updates will arrive on this server."), out.data.length ? "amber" : "green");
      });
    }, { config_id: signup.configId, response_type: "code", override_default_response_type: true, extras: { setup: {} } });
  };
  const save = (p: Partial<WaSettings>) => { setS({ ...s, ...p }); start(async () => res(await settingsAction(p))); };
  const linked = useCallback((number?: string) => { setQr(false); toast(number ? t("WhatsApp linked to {number}. Bills and reminders now go out from this phone.", { number }) : t("WhatsApp linked. Bills and reminders now go out from this phone."), "green"); router.refresh(); }, [toast, router, t]);
  const closeQr = useCallback(() => setQr(false), []);
  const fbButton = (label: string) => signup ? <Button variant="primary" disabled={pending || !sdk} onClick={launch}>{label}</Button> : null;

  return (
    <div className="flex flex-col gap-4 max-w-[1300px]">
      {paused ? (
        <div role="alert" className="border border-[#E5B4AE] bg-bad-bg rounded-xl px-4 py-3 flex flex-wrap items-center gap-3 text-[13.5px] text-bad">
          <CircleAlert size={18} />
          <span className="flex-1 min-w-[240px]"><strong className="font-semibold">{phone ? t("Phone signed out") : t("Disconnected by Meta")}</strong> {t("since {when}: {reason}.", { when: `${dayMonth(new Date(st.cfg.disconnected!.at))} ${hhmm(new Date(st.cfg.disconnected!.at))}`, reason: t(st.cfg.disconnected!.reason) })} {phone ? t("Invoices and reminders are paused and resume after you link the phone again.") : t("Invoices and reminders are paused and resume after you reconnect.")}</span>
          {phone ? <Button variant="primary" onClick={() => setQr(true)}>Link again</Button> : <>{fbButton("Reconnect with Facebook")}<Button onClick={() => setForm(true)}>Paste a new token</Button></>}
        </div>
      ) : null}
      <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))]">
        <div className={card}>
          <div className="flex items-start gap-2"><Smartphone size={20} className="text-ok shrink-0 mt-0.5" /><div className="font-semibold text-[15px] min-w-0 flex-1 leading-snug">{t("Link your phone (QR code)")}</div><Badge tone={phone && live ? "green" : phone ? "red" : "gray"} className="shrink-0">{phone && live ? "Linked" : phone ? "Link again" : "Not linked"}</Badge></div>
          {qr ? <PhoneQr onDone={linked} onClose={closeQr} /> : phone ? (
            <>
              <div className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-1.5 text-[13.5px]">
                <span className="text-muted">{t("Sending from")}</span><span>{st.cfg.displayPhone || t("the pharmacy phone")}</span>
                <span className="text-muted">{t("Linked")}</span><span>{st.rotatedAt ? `${dayMonth(new Date(st.rotatedAt), true)} ${hhmm(new Date(st.rotatedAt))}` : "—"} · {t("scanned from WhatsApp › Linked devices")}</span>
              </div>
              <div className="text-[12.5px] text-muted">{t("Bills (with the PDF), credit notes, reminders and order updates go out from this number as normal WhatsApp messages, a few seconds apart. Keep this Medoro server running (messages wait and go out when it is back) and the phone online at least once every 14 days. Message only customers who agreed to it: WhatsApp can restrict numbers that send to people who haven’t saved them.")}</div>
              <div className="flex gap-2 flex-wrap"><Button onClick={() => setQr(true)}>Link again</Button><Button variant="danger-outline" disabled={pending} onClick={() => { if (confirm(t("Unlink this phone? Medoro stops sending from it until you link again."))) start(async () => res(await disconnectAction())); }}>Unlink</Button></div>
            </>
          ) : (
            <>
              <div className="text-[13px] text-muted">{t("Send bills and reminders from the pharmacy’s own WhatsApp number, the way WhatsApp Web works: press Link WhatsApp and scan the QR code from the phone. No Meta account or templates needed.")}{meta ? ` ${t("Linking replaces the WhatsApp Business connection.")}` : ""}</div>
              {!phoneLink ? <div className="flex gap-2 flex-wrap"><Button variant={meta ? "outline" : "primary"} onClick={() => setQr(true)}><Smartphone size={15} />{t("Link WhatsApp")}</Button></div>
                : <div className="text-[12.5px] text-faint">{t(phoneLink)}</div>}
            </>
          )}
        </div>
        {/* Meta Cloud API: shown only to a pharmacy already connected through Meta (to manage or disconnect it). */}
        {meta ? (
        <div className={card}>
          <div className="flex items-start gap-2"><MessageCircle size={20} className="text-ok shrink-0 mt-0.5" /><div className="font-semibold text-[15px] min-w-0 flex-1 leading-snug">WhatsApp Business Cloud API</div><Badge tone={meta && live ? "green" : meta && paused ? "red" : "gray"} className="shrink-0">{meta && live ? "Connected" : meta && paused ? "Reconnect needed" : phone ? "Not in use" : "Not connected"}</Badge></div>
          {meta && !form ? (
            <>
              <div className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-1.5 text-[13.5px]">
                <span className="text-muted">{t("Display number")}</span><span>{st.cfg.displayPhone}{st.cfg.verifiedName ? ` · ${st.cfg.verifiedName}` : ""}</span>
                <span className="text-muted">{t("WhatsApp Business Account ID")}</span><span className="font-mono text-[12.5px]">{st.cfg.wabaId}</span>
                <span className="text-muted">{t("Phone number ID")}</span><span className="font-mono text-[12.5px]">{st.cfg.phoneNumberId}</span>
                <span className="text-muted">{t("Access token")}</span><span>{t("Encrypted on your server")}{st.rotatedAt ? ` · ${t("set {date}", { date: dayMonth(new Date(st.rotatedAt), true) })}` : ""}{st.cfg.via === "embedded" ? ` · ${t("from Embedded Signup")}` : ""} · {t("never sent to browsers")}</span>
                <span className="text-muted">{t("Webhook")}</span><span className="flex flex-col gap-1"><span className="flex items-center gap-1.5"><span className="font-mono text-[12px] break-all">{webhook}</span><button onClick={() => copy(webhook)} aria-label={t("Copy URL")} className="text-faint cursor-pointer"><Copy size={13} /></button></span>
                  <span className="flex items-center gap-1.5 text-[12.5px]">{t("Verify token")} <span className="font-mono">{st.cfg.verifyToken}</span><button onClick={() => copy(st.cfg.verifyToken)} aria-label={t("Copy token")} className="text-faint cursor-pointer"><Copy size={13} /></button></span>
                  <Badge tone={st.cfg.webhookVerified ? "green" : "amber"} className="self-start">{st.cfg.webhookVerified ? "Verified by Meta" : "Not verified yet"}</Badge></span>
              </div>
              {st.cfg.registerError ? <div className="text-[12.5px] text-bad">{t("Phone number not registered for Cloud API: {error}. Fix it in WhatsApp Manager, then reconnect.", { error: st.cfg.registerError })}</div> : null}
              <div className="flex gap-2 flex-wrap">{paused ? null : fbButton("Reconnect with Facebook")}<Button onClick={() => setForm(true)}>Rotate token</Button><Button variant="danger-outline" disabled={pending} onClick={() => { if (confirm(t("Disconnect WhatsApp? The token is deleted from this server."))) start(async () => res(await disconnectAction())); }}>Disconnect</Button></div>
            </>
          ) : !form ? (
            <>
              <div className="text-[13px] text-muted">{phone ? `${t("Instead of the linked phone, you can use the official API.")} ` : ""}{t("Connect with Meta’s Embedded Signup: log in with Facebook, pick or create your WhatsApp Business account and phone number, and Medoro finishes the setup (token, webhooks, number registration). You need a Meta Business account and a number not already on the WhatsApp app.")}</div>
              <div className="flex gap-2 flex-wrap">{fbButton("Connect with Facebook")}<Button variant="ghost" onClick={() => setForm(true)}>Enter credentials manually</Button></div>
            </>
          ) : (
            <>
              <div className="text-[13px] text-muted">{t("You need a verified Meta Business account, a WhatsApp Business API phone number, a system-user access token and your Meta app secret. Medoro checks them with Meta before saving them encrypted on your server.")}</div>
              <div className="grid grid-cols-2 gap-2.5 max-sm:grid-cols-1">
                <Field label="WhatsApp Business Account ID"><Input value={f.wabaId} onChange={(e) => setF({ ...f, wabaId: e.target.value })} className="font-mono text-[13px]" /></Field>
                <Field label="Phone number ID"><Input value={f.phoneNumberId} onChange={(e) => setF({ ...f, phoneNumberId: e.target.value })} className="font-mono text-[13px]" /></Field>
                <Field label="Access token" className="col-span-full"><Input type="password" value={f.token} onChange={(e) => setF({ ...f, token: e.target.value })} autoComplete="off" /></Field>
                <Field label="App secret"><Input type="password" value={f.appSecret} onChange={(e) => setF({ ...f, appSecret: e.target.value })} autoComplete="off" /></Field>
                <Field label="Invoice template" hint="Approved template with a document header and 3 body variables: name, invoice no, amount."><Input value={f.invoiceTemplate} onChange={(e) => setF({ ...f, invoiceTemplate: e.target.value })} className="font-mono text-[13px]" /></Field>
              </div>
              <div className="flex gap-2">
                <Button variant="primary" disabled={pending} onClick={() => start(async () => { const r = await connectAction(f); res(r); if (r.ok) { setForm(false); setF({ ...f, token: "", appSecret: "" }); } })}>{meta ? "Save new token" : "Verify & connect"}</Button>
                {st.connected || signup || !phoneLink ? <Button onClick={() => setForm(false)}>Cancel</Button> : null}
              </div>
            </>
          )}
        </div>
        ) : null}
        <div className={card}>
          <div className="font-semibold text-[15px]">{t("Invoice delivery")}</div>
          <label className="flex gap-3 cursor-pointer items-start"><input type="checkbox" className="accent-teal size-4 mt-1 flex-none" checked={s.auto} disabled={!st.connected || pending} onChange={(e) => save({ auto: e.target.checked })} /><span className="flex flex-col"><span className="text-[14px] font-medium">{t("Auto-send after sale")}</span><span className="text-[12.5px] text-muted">{t("Only for customers with recorded WhatsApp consent whose number isn’t flagged. Others still need the cashier to confirm the number.")}</span></span></label>
          <label className="flex gap-3 cursor-pointer items-start"><input type="checkbox" className="accent-teal size-4 mt-1 flex-none" checked={s.pdf} disabled={pending} onChange={(e) => save({ pdf: e.target.checked })} /><span className="flex flex-col"><span className="text-[14px] font-medium">{t("Attach the invoice PDF")}</span><span className="text-[12.5px] text-muted">{s.pdf ? phone ? <>{t("The PDF is sent as a document with a short message.")}</> : <>{t("The PDF is uploaded to WhatsApp and sent with your invoice template")}{st.connected && st.cfg.invoiceTemplate ? <> (<span className="font-mono text-[12px]">{st.cfg.invoiceTemplate}</span>)</> : null}.</> : <>{phone ? t("A text message with a link to the PDF on this server that works for 7 days.") : t("Text-only template; its 4th variable is a link to the PDF on this server that works for 7 days.")}</>}</span></span></label>
          {!s.pdf && meta ? (
            <div className="flex gap-2 items-start pl-7">
              <Field label="Text-only invoice template" hint="Body: name, invoice no., amount, link." className="flex-1 min-w-0"><Input value={names.textTemplate} onChange={(e) => setNames({ ...names, textTemplate: e.target.value })} className="font-mono text-[13px]" /></Field>
              <Button className="mt-[26px]" disabled={pending || names.textTemplate === s.textTemplate} onClick={() => save({ textTemplate: names.textTemplate })}>Save</Button>
            </div>
          ) : null}
          {phone ? <div className="text-[12.5px] text-ok">{s.auto ? t("Medoro writes the messages and sends them from your phone; auto-send is active.") : t("Medoro writes the messages and sends them from your phone.")}</div> : st.connected ? (invoiceTemplate.ok
            ? <div className="text-[12.5px] text-ok">{t("Template")} <span className="font-mono">{invoiceTemplate.name}</span> {s.auto ? t("is approved; auto-send is active.") : t("is approved.")}</div>
            : <div role="alert" className="text-[12.5px] text-bad flex gap-1.5"><CircleAlert size={14} className="mt-0.5 flex-none" /><span>{invoiceTemplate.error ? t(invoiceTemplate.error) : null} {s.auto ? t("Auto-send is paused until it’s approved.") : t("Invoices can’t be sent until then.")}</span></div>) : null}
          {!meta ? null : <>
          <div className="flex gap-2 items-start">
            <Field label="Credit note template" hint="Sent from Returns. Body: name, credit note no., amount, invoice no." className="flex-1 min-w-0"><Input value={names.creditNoteTemplate} onChange={(e) => setNames({ ...names, creditNoteTemplate: e.target.value })} className="font-mono text-[13px]" /></Field>
            <Button className="mt-[26px]" disabled={pending || names.creditNoteTemplate === s.creditNoteTemplate} onClick={() => save({ creditNoteTemplate: names.creditNoteTemplate })}>Save</Button>
          </div>
          <div className="flex items-center justify-between pt-1"><div className="text-[12.5px] text-muted font-medium">{t("Message templates")}</div>{st.connected ? <Button size="sm" disabled={pending} onClick={() => start(async () => { const r = await templatesAction(); toast(r.ok ? t("{n} templates synced from Meta.", { n: r.data }) : r.error, r.ok ? "green" : "red"); })}><RefreshCw size={13} />{t("Sync")}</Button> : null}</div>
          {st.connected && st.cfg.templates.length ? st.cfg.templates.map((x) => (
            <div key={x.name + x.language} className="flex items-center gap-2 text-[13px] py-1 border-b border-row last:border-0"><span className="font-mono">{x.name}</span><span className="text-faint">{x.language} · {x.category}{x.header ? ` · ${t("{kind} header", { kind: x.header.toLowerCase() })}` : ""}</span><Badge tone={ST[x.status] ?? "gray"} className="ml-auto">{t(x.status)}</Badge></div>
          )) : <div className="text-[13px] text-fainter">{st.connected ? t("No templates synced yet.") : t("Connect to see your approved templates.")}</div>}
          </>}
        </div>
      </div>
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        {[["Sent today", log.counts.sent], ["Delivered", log.counts.delivered], ["Read", log.counts.read], ["Failed", log.counts.failed]].map(([k, v]) => <div key={k} className="bg-white border border-line rounded-xl px-4 py-3 flex flex-col"><span className="text-[12.5px] text-muted">{t(String(k))}</span><span className="text-[22px] font-semibold tnum">{v}</span></div>)}
      </div>
      <div className="bg-white border border-line rounded-xl overflow-auto tbl-scroll">
        <div className="font-semibold text-[15px] px-4 pt-3.5 pb-2">{t("Delivery log")}</div>
        {log.rows.length ? (
          <table className="w-full border-collapse min-w-[860px] text-[13.5px]">
            <thead><tr className="bg-subtle">{["Time", "Message", "Recipient", "Status", "Attempts", ""].map((x) => <th key={x} className="text-left text-[12px] font-medium text-muted px-3.5 py-2.5 border-b border-[#E3E6E9]">{x ? t(x) : ""}</th>)}</tr></thead>
            <tbody>
              {log.rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-3.5 py-2.5 border-b border-row whitespace-nowrap">{dayMonth(new Date(r.at))} {hhmm(new Date(r.at))}</td>
                  <td className="px-3.5 py-2.5 border-b border-row"><div className="font-mono text-[12.5px]">{r.invoiceNo}</div><div className="text-[11.5px] text-faint">{t(r.kind)}{r.channel === "sms" ? " · SMS" : ""}</div></td>
                  <td className="px-3.5 py-2.5 border-b border-row tnum">{r.to.slice(0, 5)} {r.to.slice(5)}</td>
                  <td className="px-3.5 py-2.5 border-b border-row"><Badge tone={ST[r.status]}>{t(r.status)}</Badge>{r.error ? <div className="text-[12px] text-bad mt-0.5">{t(r.error)}</div> : null}
                    {r.status === "failed" ? <div className="text-[11.5px] text-faint mt-0.5">{r.errorKind === "auth" ? t("Waiting for WhatsApp to be reconnected") : r.nextAttemptAt && r.retryable ? t("Retries automatically at {time}", { time: hhmm(new Date(r.nextAttemptAt)) }) : r.retryable ? "" : r.errorKind === "invalid" ? t("Not retried: fix the number on the customer") : t("Not retried: permanent failure")}</div> : null}</td>
                  <td className="px-3.5 py-2.5 border-b border-row tnum">{r.attempts}</td>
                  <td className="px-3.5 py-2.5 border-b border-row text-right">{r.status === "failed" && r.retryable && (r.channel === "sms" || live) ? <Button size="sm" disabled={pending} onClick={() => start(async () => res(await retryAction(r.id)))}>Retry</Button> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="px-4 pb-4 text-[13px] text-fainter">{t("No messages yet. Invoices sent from Billing show here with their delivery status.")}</div>}
      </div>
    </div>
  );
}
