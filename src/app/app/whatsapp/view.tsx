"use client";
import { useState, useTransition } from "react";
import { MessageCircle, RefreshCw, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, type Tone } from "@/components/ui/badge";
import { Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { dayMonth, hhmm } from "@/lib/dates";
import type { messageLog, waStatus } from "@/domain/comms/whatsapp";
import { autoAction, connectAction, disconnectAction, retryAction, templatesAction } from "./actions";

const card = "bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] p-4 flex flex-col gap-3";
const ST: Record<string, Tone> = { queued: "gray", sent: "blue", delivered: "teal", read: "green", failed: "red", approved: "green", pending: "amber", rejected: "red" };

export function WhatsAppView({ st, log, auto: initialAuto, webhook }: { st: Awaited<ReturnType<typeof waStatus>>; log: Awaited<ReturnType<typeof messageLog>>; auto: boolean; webhook: string }) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [form, setForm] = useState(!st.connected);
  const [f, setF] = useState({ wabaId: st.connected ? st.cfg.wabaId : "", phoneNumberId: st.connected ? st.cfg.phoneNumberId : "", token: "", appSecret: "", invoiceTemplate: st.connected ? st.cfg.invoiceTemplate : "invoice_share", templateLang: st.connected ? st.cfg.templateLang : "en" });
  const [auto, setAuto] = useState(initialAuto);
  const res = (r: { ok: true; message?: string } | { ok: false; error: string }) => toast(r.ok ? r.message ?? "Done." : r.error, r.ok ? "green" : "red");
  const copy = (s: string) => { navigator.clipboard.writeText(s); toast("Copied.", "gray"); };
  return (
    <div className="flex flex-col gap-4 max-w-[1300px]">
      <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))]">
        <div className={card}>
          <div className="flex items-center gap-2"><MessageCircle size={20} className="text-ok" /><div className="font-semibold text-[15px]">WhatsApp Business Cloud API</div><Badge tone={st.connected ? "green" : "gray"} className="ml-auto">{st.connected ? "Connected" : "Not connected"}</Badge></div>
          {st.connected && !form ? (
            <>
              <div className="grid grid-cols-[130px_1fr] gap-x-3 gap-y-1.5 text-[13.5px]">
                <span className="text-muted">Display number</span><span>{st.cfg.displayPhone}{st.cfg.verifiedName ? ` · ${st.cfg.verifiedName}` : ""}</span>
                <span className="text-muted">WABA ID</span><span className="font-mono text-[12.5px]">{st.cfg.wabaId}</span>
                <span className="text-muted">Phone number ID</span><span className="font-mono text-[12.5px]">{st.cfg.phoneNumberId}</span>
                <span className="text-muted">Access token</span><span>Sealed on this server{st.rotatedAt ? ` · set ${dayMonth(new Date(st.rotatedAt), true)}` : ""} · never sent to browsers</span>
                <span className="text-muted">Webhook</span><span className="flex flex-col gap-1"><span className="flex items-center gap-1.5"><span className="font-mono text-[12px] break-all">{webhook}</span><button onClick={() => copy(webhook)} aria-label="Copy URL" className="text-faint cursor-pointer"><Copy size={13} /></button></span>
                  <span className="flex items-center gap-1.5 text-[12.5px]">Verify token <span className="font-mono">{st.cfg.verifyToken}</span><button onClick={() => copy(st.cfg.verifyToken)} aria-label="Copy token" className="text-faint cursor-pointer"><Copy size={13} /></button></span>
                  <Badge tone={st.cfg.webhookVerified ? "green" : "amber"} className="self-start">{st.cfg.webhookVerified ? "Verified by Meta" : "Not verified yet"}</Badge></span>
              </div>
              <div className="flex gap-2"><Button onClick={() => setForm(true)}>Rotate token</Button><Button variant="danger-outline" disabled={pending} onClick={() => { if (confirm("Disconnect WhatsApp? The token is deleted from this server.")) start(async () => res(await disconnectAction())); }}>Disconnect</Button></div>
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
                {st.connected ? <Button onClick={() => setForm(false)}>Cancel</Button> : null}
              </div>
            </>
          )}
        </div>
        <div className={card}>
          <div className="font-semibold text-[15px]">Invoice delivery</div>
          <label className="flex gap-3 cursor-pointer items-start"><input type="checkbox" className="accent-teal size-4 mt-1" checked={auto} disabled={!st.connected || pending} onChange={(e) => { setAuto(e.target.checked); start(async () => res(await autoAction(e.target.checked))); }} /><span className="flex flex-col"><span className="text-[14px] font-medium">Auto-send after sale</span><span className="text-[12.5px] text-muted">Only for customers with recorded WhatsApp consent. Others still need the cashier to confirm the number.</span></span></label>
          <div className="text-[13px] text-ink-2">Invoices go as a PDF generated on your server from the committed sale. Prescriber details are left out.</div>
          <div className="flex items-center justify-between pt-1"><div className="text-[12.5px] text-muted font-medium">Message templates</div>{st.connected ? <Button size="sm" disabled={pending} onClick={() => start(async () => { const r = await templatesAction(); toast(r.ok ? `${r.data} templates synced from Meta.` : r.error, r.ok ? "green" : "red"); })}><RefreshCw size={13} />Sync</Button> : null}</div>
          {st.connected && st.cfg.templates.length ? st.cfg.templates.map((t) => (
            <div key={t.name + t.language} className="flex items-center gap-2 text-[13px] py-1 border-b border-row last:border-0"><span className="font-mono">{t.name}</span><span className="text-faint">{t.language} · {t.category}</span><Badge tone={ST[t.status] ?? "gray"} className="ml-auto">{t.status}</Badge></div>
          )) : <div className="text-[13px] text-fainter">{st.connected ? "No templates synced yet." : "Connect to see your approved templates."}</div>}
        </div>
      </div>
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        {[["Sent today", log.counts.sent], ["Delivered", log.counts.delivered], ["Read", log.counts.read], ["Failed", log.counts.failed]].map(([k, v]) => <div key={k} className="bg-white border border-line rounded-xl px-4 py-3 flex flex-col"><span className="text-[12.5px] text-muted">{k}</span><span className="text-[22px] font-semibold tnum">{v}</span></div>)}
      </div>
      <div className="bg-white border border-line rounded-xl overflow-auto">
        <div className="font-semibold text-[15px] px-4 pt-3.5 pb-2">Delivery log</div>
        {log.rows.length ? (
          <table className="w-full border-collapse min-w-[760px] text-[13.5px]">
            <thead><tr className="bg-subtle">{["Time", "Invoice", "Recipient", "Status", "Attempts", ""].map((x) => <th key={x} className="text-left text-[12px] font-medium text-muted px-3.5 py-2.5 border-b border-[#E3E6E9]">{x}</th>)}</tr></thead>
            <tbody>
              {log.rows.map((r) => (
                <tr key={r.id}>
                  <td className="px-3.5 py-2.5 border-b border-row">{dayMonth(new Date(r.at))} {hhmm(new Date(r.at))}</td>
                  <td className="px-3.5 py-2.5 border-b border-row font-mono text-[12.5px]">{r.invoiceNo}</td>
                  <td className="px-3.5 py-2.5 border-b border-row tnum">{r.to.slice(0, 5)} {r.to.slice(5)}</td>
                  <td className="px-3.5 py-2.5 border-b border-row"><Badge tone={ST[r.status]}>{r.status}</Badge>{r.error ? <div className="text-[12px] text-bad mt-0.5">{r.error}</div> : null}</td>
                  <td className="px-3.5 py-2.5 border-b border-row tnum">{r.attempts}</td>
                  <td className="px-3.5 py-2.5 border-b border-row text-right">{r.status === "failed" && r.attempts < 3 && st.connected ? <Button size="sm" disabled={pending} onClick={() => start(async () => res(await retryAction(r.id)))}>Retry</Button> : null}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="px-4 pb-4 text-[13px] text-fainter">No messages yet. Invoices sent from Billing show here with their delivery status.</div>}
      </div>
    </div>
  );
}
