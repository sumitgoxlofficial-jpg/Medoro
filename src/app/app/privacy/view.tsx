"use client";
import { useState, useTransition } from "react";
import { Download, ShieldCheck, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { Privacy } from "@/domain/system/privacy";
import { aiSettingsAction } from "@/app/app/ai-actions";
import { eraseAction, privacyAction } from "./actions";
import { useT } from "@/lib/i18n-client";

type AiView = { enabled: boolean; globalOff: boolean; remoteNames: boolean; mode: "rules" | "local" | "remote"; note: string | null; remoteHost: string | null };

const card = "app-card bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] p-4 flex flex-col gap-3";

function Toggle({ checked, onChange, title, body, disabled }: { checked: boolean; onChange: (v: boolean) => void; title: string; body: string; disabled?: boolean }) {
  const t = useT();
  return (
    <label className="flex gap-3 cursor-pointer items-start">
      <input type="checkbox" className="accent-teal size-4 mt-1 flex-none" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="flex flex-col"><span className="text-[14px] font-medium">{t(title)}</span><span className="text-[12.5px] text-muted">{body}</span></span>
    </label>
  );
}

export function PrivacyView({ p: initial, customers, wa, drive, driveRecords = false, licence, ai: aiInitial, strictRules, telemetryUrl, crashUrl }: { p: Privacy; customers: { id: string; name: string }[]; wa: boolean; drive: boolean; driveRecords?: boolean; licence: boolean; ai: AiView; strictRules: string[]; telemetryUrl: boolean; crashUrl: boolean }) {
  const toast = useToast();
  const t = useT();
  const [p, setP] = useState(initial);
  const [ai, setAi] = useState(aiInitial);
  const [erase, setErase] = useState("");
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const exportHref = (format: "json" | "csv") => `/api/export?format=${format}${reason.trim() ? `&reason=${encodeURIComponent(reason.trim())}` : ""}`;
  const sendNote = (url: boolean, what: string) => (p.strict ? t("Off while strict mode is on.") : url ? t("Sent to the address set on your server.") : t(what === "telemetry" ? "No telemetry address is set on this server, so nothing is sent." : "No crash report address is set on this server, so nothing is sent."));
  const save = (patch: Partial<Privacy>, msg?: string) => start(async () => { const r = await privacyAction(patch); if (!r.ok) return toast(r.error, "red"); setP(r.data); if (msg) toast(msg, "amber"); });
  const saveAi = (patch: { enabled?: boolean; remoteNames?: boolean }) => start(async () => { const r = await aiSettingsAction(patch); if (!r.ok) return toast(r.error, "red"); setAi((x) => ({ ...x, ...r.data })); });
  const remoteGets = !p.remoteAi || p.strict ? t("Nothing (remote AI is off)") : aiInitial.mode !== "remote" ? t("Nothing (no remote provider in use)") : `${t(ai.remoteNames ? "Your question and tool results (totals, item and supplier names), including customer names" : "Your question and tool results (totals, item and supplier names); customer names, phone numbers and emails replaced with placeholders")}${aiInitial.remoteHost ? ` · ${aiInitial.remoteHost}` : ""}`;
  const svc = [
    { svc: "Medoro control plane", gets: licence ? t("Pharmacy name and owner contact (once), plan, app version, branch and counter counts, and the tickets, payment references and support-access answers you send") : t("Nothing (licence server not configured)"), never: t("Invoices, stock, customers, backups") },
    { svc: "Meta WhatsApp Cloud API", gets: wa ? t("Recipient number, invoice PDF, template text") : t("Nothing (not connected)"), never: t("Prescriber details, other records") },
    { svc: "Google Drive", gets: drive ? (driveRecords ? t("Your pharmacy’s records, encrypted on your devices before upload") : t("Encrypted backup files only")) : t("Nothing (not connected)"), never: t("Encryption key or readable data") },
    { svc: "External AI provider", gets: remoteGets, never: t("Credentials, keys, full database, logs of your questions") },
  ];
  return (
    <div className="flex flex-col gap-4 max-w-[1200px]">
      <div className="flex items-center gap-2 px-4 py-2.5 rounded-[10px] text-[13.5px] font-medium" style={{ background: p.strict ? "#E6F4EC" : "#FDF2E1", color: p.strict ? "#1E7F4F" : "#94570A" }}>
        {p.strict ? <ShieldCheck size={16} /> : <ShieldAlert size={16} />}{p.strict ? t("Strict customer-controlled mode is on") : t("Strict mode is off")}
      </div>
      <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(min(100%,420px),1fr))]">
        <div className={card}>
          <div className="font-semibold text-[15px]">{t("Data controls")}</div>
          <Toggle checked={p.strict} onChange={(v) => save({ strict: v })} title="Strict customer-controlled mode" body={t("Transactions, analytics, reports and AI all stay on your server. Nothing operational is copied to Medoro.")} />
          {p.strict ? <ul className="m-0 pl-9 text-[12.5px] text-muted list-disc">{strictRules.map((r) => <li key={r}>{t(r)}</li>)}</ul> : null}
          <Toggle checked={ai.enabled && !ai.globalOff} disabled={ai.globalOff || pending} onChange={(v) => saveAi({ enabled: v })} title="AI assistant" body={ai.globalOff ? t("Switched off by your server administrator.") : t(aiInitial.note ? "Shows the Ask AI panel to all users. Off hides it and refuses all AI requests; billing never depends on it. Currently: {mode} ({note})." : "Shows the Ask AI panel to all users. Off hides it and refuses all AI requests; billing never depends on it. Currently: {mode}.", { mode: t(aiInitial.mode === "remote" ? "remote AI model" : aiInitial.mode === "local" ? "AI model on your server" : "built-in rules, no AI model"), note: aiInitial.note ? t(aiInitial.note) : "" })} />
          <Toggle checked={p.remoteAi} onChange={(v) => save({ remoteAi: v }, v ? "Remote AI on. Strict mode is relaxed." : undefined)} title="Allow remote AI provider" body={aiInitial.remoteHost ? t("Lets the assistant use the remote AI model set up on this server ({host}). Strict mode must be off.", { host: aiInitial.remoteHost }) : t("No remote AI provider is set up on this server, so the assistant stays on your server.")} />
          <Toggle checked={ai.remoteNames} disabled={!p.remoteAi || pending} onChange={(v) => saveAi({ remoteNames: v })} title="Share customer names with the remote AI" body={t("Off: customer names, phone numbers and emails are replaced with placeholders before anything is sent, and put back in the answer on your server.")} />
          <Toggle checked={p.telemetry} onChange={(v) => save({ telemetry: v })} title="Anonymous usage telemetry" body={`${t("Once a day: app version and rounded counts (branches, users, medicines, bills in the last day). No names, numbers or amounts.")} ${sendNote(telemetryUrl, "telemetry")}`} />
          <Toggle checked={p.crash} onChange={(v) => save({ crash: v })} title="Crash reports" body={`${t("Error type and code location when a page fails, with names, numbers, emails, IDs and tokens removed on this server first.")} ${sendNote(crashUrl, "crash report")}`} />
          <label className="flex flex-wrap items-center gap-2 text-[13.5px]">{t("Anonymise customers inactive for")}
            <select value={p.retentionYears} onChange={(e) => save({ retentionYears: Number(e.target.value) })} className="h-10 border border-input rounded-lg px-2.5 bg-white">{[3, 5, 8, 10].map((y) => <option key={y} value={y}>{t("{n} years", { n: y })}</option>)}</select>
          </label>
          <div className="text-[12px] text-faint">{t("Invoices, accounts, stock records and the audit trail are never deleted, whatever you choose here: keep them at least 8 years. Check retention periods with your CA and the drug licensing authority.")}</div>
        </div>
        <div className={card}>
          <div className="font-semibold text-[15px]">{t("Export & erase")}</div>
          <div className="flex gap-2 flex-wrap">
            <a href={exportHref("json")} className="flex items-center gap-1.5 border border-input rounded-lg px-3 py-2 text-[13.5px] text-ink no-underline hover:border-teal"><Download size={15} />{t("Export all data (JSON)")}</a>
            <a href={exportHref("csv")} className="flex items-center gap-1.5 border border-input rounded-lg px-3 py-2 text-[13.5px] text-ink no-underline hover:border-teal"><Download size={15} />{t("Export as CSV (ZIP, one file per table)")}</a>
          </div>
          {p.strict ? <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("Reason, to include customer mobile numbers (optional)")} aria-label={t("Reason for including customer mobile numbers")} className="border border-input rounded-lg px-2.5 py-2 text-[13px] bg-white" /> : null}
          <div className="text-[12px] text-faint">{t("Every table your pharmacy owns. Passwords, PINs and integration secrets are left out.")}{p.strict ? ` ${t("In strict mode customer mobile numbers are masked unless you give a reason; the reason is kept in the audit trail.")}` : ""} {t("For a full database copy, ask your IT person (see Data ownership in the help guide).")}</div>
          <div className="flex gap-2 flex-wrap pt-2 border-t border-line-soft">
            <select value={erase} onChange={(e) => setErase(e.target.value)} aria-label={t("Customer to erase")} className="border border-input rounded-lg px-2.5 py-2 text-[13.5px] bg-white flex-1 min-w-[200px]">
              <option value="">{t("Customer erasure request…")}</option>{customers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <Button variant="danger-outline" disabled={!erase || pending} onClick={() => { if (confirm(t("Erase this customer’s name and phone? This can’t be undone."))) start(async () => { const r = await eraseAction(erase); toast(r.ok ? r.message! : r.error, r.ok ? "green" : "red"); if (r.ok) setErase(""); }); }}>Erase personal data</Button>
          </div>
          <div className="text-[12px] text-faint">{t("Erasure removes the name and phone number. Tax invoices are kept with an anonymised party as the law requires. Customers with an outstanding balance can’t be erased until it’s settled.")}</div>
        </div>
      </div>
      <div className={card}>
        <div className="font-semibold text-[15px]">{t("External services that receive data")}</div>
        {svc.map((x) => (
          <div key={x.svc} className="grid grid-cols-[200px_minmax(0,1fr)_minmax(0,1fr)] gap-3 py-2 border-b border-row last:border-0 text-[13.5px] max-md:grid-cols-1">
            <strong className="font-semibold">{t(x.svc)}</strong><span><span className="text-faint">{t("Receives")} · </span>{x.gets}</span><span><span className="text-faint">{t("Never")} · </span>{x.never}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
