"use client";
import { useState, useTransition } from "react";
import { Download, ShieldCheck, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import type { Privacy } from "@/domain/system/privacy";
import { eraseAction, privacyAction } from "./actions";

const card = "bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] p-4 flex flex-col gap-3";

function Toggle({ checked, onChange, title, body, disabled }: { checked: boolean; onChange: (v: boolean) => void; title: string; body: string; disabled?: boolean }) {
  return (
    <label className="flex gap-3 cursor-pointer items-start">
      <input type="checkbox" className="accent-teal size-4 mt-1" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
      <span className="flex flex-col"><span className="text-[14px] font-medium">{title}</span><span className="text-[12.5px] text-muted">{body}</span></span>
    </label>
  );
}

export function PrivacyView({ p: initial, customers, wa, drive, licence }: { p: Privacy; customers: { id: string; name: string }[]; wa: boolean; drive: boolean; licence: boolean }) {
  const toast = useToast();
  const [p, setP] = useState(initial);
  const [erase, setErase] = useState("");
  const [pending, start] = useTransition();
  const save = (patch: Partial<Privacy>, msg?: string) => start(async () => { const r = await privacyAction(patch); if (!r.ok) return toast(r.error, "red"); setP(r.data); if (msg) toast(msg, "amber"); });
  const svc = [
    { svc: "Medoro control plane", gets: licence ? "Pharmacy name and owner contact (once), plan, app version, branch and counter counts, and the tickets, payment references and support-access answers you send" : "Nothing (licence server not configured)", never: "Invoices, stock, customers, backups" },
    { svc: "Meta WhatsApp Cloud API", gets: wa ? "Recipient number, invoice PDF, template text" : "Nothing (not connected)", never: "Prescriber details, other records" },
    { svc: "Google Drive", gets: drive ? "Encrypted backup files only" : "Nothing (not connected)", never: "Encryption key or readable data" },
    { svc: "External AI provider", gets: p.remoteAi ? "Minimised query context (aggregates, no customer names)" : "Nothing (remote AI is off)", never: "Credentials, keys, full database" },
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
          <Toggle checked={p.remoteAi} onChange={(v) => save({ remoteAi: v }, v ? "Remote AI on. Strict mode is relaxed." : undefined)} title="Allow remote AI provider" body="Would send minimised context (aggregates, no names or phone numbers). No remote provider is configured in this version, so the assistant stays local either way." />
          <Toggle checked={p.telemetry} onChange={(v) => save({ telemetry: v })} title="Anonymous usage telemetry" body="Records your preference. This version doesn’t send telemetry." />
          <Toggle checked={p.crash} onChange={(v) => save({ crash: v })} title="Crash reports" body="Records your preference. This version doesn’t send crash reports." />
          <label className="flex items-center gap-2 text-[13.5px]">Keep sales & prescription records for
            <select value={p.retentionYears} onChange={(e) => save({ retentionYears: Number(e.target.value) })} className="border border-input rounded-md px-2 py-1 bg-white">{[3, 5, 8, 10].map((y) => <option key={y} value={y}>{y} years</option>)}</select>
          </label>
          <div className="text-[12px] text-faint">Check retention periods with your CA and the drug licensing authority before shortening them.</div>
        </div>
        <div className={card}>
          <div className="font-semibold text-[15px]">Export & erase</div>
          <a href="/api/export" className="self-start flex items-center gap-1.5 border border-input rounded-lg px-3 py-2 text-[13.5px] text-ink no-underline hover:border-teal"><Download size={15} />Export all pharmacy data (JSON)</a>
          <div className="text-[12px] text-faint">Every table your pharmacy owns, in one file. Passwords, PINs and integration secrets are left out. For a database-level copy, use pg_dump on your server.</div>
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
