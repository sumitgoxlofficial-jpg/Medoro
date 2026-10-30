"use client";
import { useState, useTransition } from "react";
import { Download, ShieldCheck, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { Privacy } from "@/domain/system/privacy";
import { aiSettingsAction } from "@/app/app/ai-actions";
import { eraseAction, privacyAction } from "./actions";

type AiView = { enabled: boolean; globalOff: boolean; remoteNames: boolean; mode: "rules" | "local" | "remote"; note: string | null; remoteHost: string | null };

const card = "bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] p-4 flex flex-col gap-3";

function Toggle({ checked, onChange, title, body, disabled }: { checked: boolean; onChange: (v: boolean) => void; title: string; body: string; disabled?: boolean }) {
  return (
    <label className="flex gap-3 cursor-pointer items-start">
      <input type="checkbox" className="accent-teal size-4 mt-1" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="flex flex-col"><span className="text-[14px] font-medium">{title}</span><span className="text-[12.5px] text-muted">{body}</span></span>
    </label>
  );
}

export function PrivacyView({ p: initial, customers, wa, drive, licence, ai: aiInitial, strictRules, telemetryUrl, crashUrl }: { p: Privacy; customers: { id: string; name: string }[]; wa: boolean; drive: boolean; licence: boolean; ai: AiView; strictRules: string[]; telemetryUrl: boolean; crashUrl: boolean }) {
  const toast = useToast();
  const [p, setP] = useState(initial);
  const [ai, setAi] = useState(aiInitial);
  const [erase, setErase] = useState("");
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const exportHref = (format: "json" | "csv") => `/api/export?format=${format}${reason.trim() ? `&reason=${encodeURIComponent(reason.trim())}` : ""}`;
  const sendNote = (url: boolean, what: string) => (p.strict ? `Off while strict mode is on.` : url ? `Sent to the address set on your server.` : `No ${what} address is set on this server, so nothing is sent.`);
  const save = (patch: Partial<Privacy>, msg?: string) => start(async () => { const r = await privacyAction(patch); if (!r.ok) return toast(r.error, "red"); setP(r.data); if (msg) toast(msg, "amber"); });
  const saveAi = (patch: { enabled?: boolean; remoteNames?: boolean }) => start(async () => { const r = await aiSettingsAction(patch); if (!r.ok) return toast(r.error, "red"); setAi((x) => ({ ...x, ...r.data })); });
  const remoteGets = !p.remoteAi || p.strict ? "Nothing (remote AI is off)" : aiInitial.mode !== "remote" ? "Nothing (no remote provider in use)" : `Your question and tool results (totals, item and supplier names)${ai.remoteNames ? ", including customer names" : "; customer names, phone numbers and emails replaced with placeholders"}${aiInitial.remoteHost ? ` · ${aiInitial.remoteHost}` : ""}`;
  const svc = [
    { svc: "Medoro control plane", gets: licence ? "Pharmacy name and owner contact (once), plan, app version, branch and counter counts, and the tickets, payment references and support-access answers you send" : "Nothing (licence server not configured)", never: "Invoices, stock, customers, backups" },
    { svc: "Meta WhatsApp Cloud API", gets: wa ? "Recipient number, invoice PDF, template text" : "Nothing (not connected)", never: "Prescriber details, other records" },
    { svc: "Google Drive", gets: drive ? "Encrypted backup files only" : "Nothing (not connected)", never: "Encryption key or readable data" },
    { svc: "External AI provider", gets: remoteGets, never: "Credentials, keys, full database, logs of your questions" },
  ];
  return (
    <div className="flex flex-col gap-4 max-w-[1200px]">
      <div className="flex items-center gap-2 px-4 py-2.5 rounded-[10px] text-[13.5px] font-medium" style={{ background: p.strict ? "#E6F4EC" : "#FDF2E1", color: p.strict ? "#1E7F4F" : "#94570A" }}>
        {p.strict ? <ShieldCheck size={16} /> : <ShieldAlert size={16} />}{p.strict ? "Strict customer-controlled mode is on" : "Strict mode is off"}
      </div>
      <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))]">
        <div className={card}>
          <div className="font-semibold text-[15px]">Data controls</div>
          <Toggle checked={p.strict} onChange={(v) => save({ strict: v })} title="Strict customer-controlled mode" body="Transactions, analytics, reports and AI all stay on your server. Nothing operational is copied to Medoro." />
          {p.strict ? <ul className="m-0 pl-9 text-[12.5px] text-muted list-disc">{strictRules.map((r) => <li key={r}>{r}</li>)}</ul> : null}
          <Toggle checked={ai.enabled && !ai.globalOff} disabled={ai.globalOff || pending} onChange={(v) => saveAi({ enabled: v })} title="AI assistant" body={ai.globalOff ? "Switched off on this server (AI_ENABLED=0)." : `Ask AI drawer for every user. Off hides it and refuses all AI requests; billing never depends on it. Now: ${aiInitial.mode === "remote" ? "remote model" : aiInitial.mode === "local" ? "local model" : "rules on your server, no model"}${aiInitial.note ? ` (${aiInitial.note})` : ""}.`} />
          <Toggle checked={p.remoteAi} onChange={(v) => save({ remoteAi: v }, v ? "Remote AI on. Strict mode is relaxed." : undefined)} title="Allow remote AI provider" body={aiInitial.remoteHost ? `Lets the assistant use the configured remote model (${aiInitial.remoteHost}) when AI_MODE=remote. Strict mode must be off.` : "No remote provider is configured on this server (REMOTE_AI_URL), so the assistant stays local either way."} />
          <Toggle checked={ai.remoteNames} disabled={!p.remoteAi || pending} onChange={(v) => saveAi({ remoteNames: v })} title="Share customer names with the remote AI" body="Off: customer names, phone numbers and emails are replaced with placeholders before anything is sent, and put back in the answer on your server." />
          <Toggle checked={p.telemetry} onChange={(v) => save({ telemetry: v })} title="Anonymous usage telemetry" body={`Once a day: app version and rounded counts (branches, users, medicines, bills in the last day). No names, numbers or amounts. ${sendNote(telemetryUrl, "telemetry")}`} />
          <Toggle checked={p.crash} onChange={(v) => save({ crash: v })} title="Crash reports" body={`Error type and code location when a page fails, with names, numbers, emails, IDs and tokens removed on this server first. ${sendNote(crashUrl, "crash report")}`} />
          <label className="flex items-center gap-2 text-[13.5px]">Anonymise customers inactive for
            <select value={p.retentionYears} onChange={(e) => save({ retentionYears: Number(e.target.value) })} className="border border-input rounded-md px-2 py-1 bg-white">{[3, 5, 8, 10].map((y) => <option key={y} value={y}>{y} years</option>)}</select>
          </label>
          <div className="text-[12px] text-faint">Invoices, accounts, stock records and the audit trail are never deleted, whatever you choose here: keep them at least 8 years. Check retention periods with your CA and the drug licensing authority.</div>
        </div>
        <div className={card}>
          <div className="font-semibold text-[15px]">Export & erase</div>
          <div className="flex gap-2 flex-wrap">
            <a href={exportHref("json")} className="flex items-center gap-1.5 border border-input rounded-lg px-3 py-2 text-[13.5px] text-ink no-underline hover:border-teal"><Download size={15} />Export all data (JSON)</a>
            <a href={exportHref("csv")} className="flex items-center gap-1.5 border border-input rounded-lg px-3 py-2 text-[13.5px] text-ink no-underline hover:border-teal"><Download size={15} />Export as CSV (ZIP, one file per table)</a>
          </div>
          {p.strict ? <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason, to include customer mobile numbers (optional)" aria-label="Reason for including customer mobile numbers" className="border border-input rounded-lg px-2.5 py-2 text-[13px] bg-white" /> : null}
          <div className="text-[12px] text-faint">Every table your pharmacy owns. Passwords, PINs and integration secrets are left out.{p.strict ? " In strict mode customer mobile numbers are masked unless you give a reason; the reason is kept in the audit trail." : ""} For a database-level copy, use pg_dump (see Data ownership in the docs).</div>
          <div className="flex gap-2 flex-wrap pt-2 border-t border-line-soft">
            <select value={erase} onChange={(e) => setErase(e.target.value)} aria-label="Customer to erase" className="border border-input rounded-lg px-2.5 py-2 text-[13.5px] bg-white flex-1 min-w-[200px]">
              <option value="">Customer erasure request…</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <Button variant="danger-outline" disabled={!erase || pending} onClick={() => { if (confirm("Erase this customer’s name and phone? This can’t be undone.")) start(async () => { const r = await eraseAction(erase); toast(r.ok ? r.message! : r.error, r.ok ? "green" : "red"); if (r.ok) setErase(""); }); }}>Erase personal data</Button>
          </div>
          <div className="text-[12px] text-faint">Erasure removes the name and phone number. Tax invoices are kept with an anonymised party as the law requires. Customers with an outstanding balance can’t be erased until it’s settled.</div>
        </div>
      </div>
      <div className={card}>
        <div className="font-semibold text-[15px]">External services that receive data</div>
        {svc.map((x) => (
          <div key={x.svc} className="grid grid-cols-[200px_minmax(0,1fr)_minmax(0,1fr)] gap-3 py-2 border-b border-row last:border-0 text-[13.5px] max-md:grid-cols-1">
            <strong className="font-semibold">{x.svc}</strong><span><span className="text-faint">Receives · </span>{x.gets}</span><span><span className="text-faint">Never · </span>{x.never}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
