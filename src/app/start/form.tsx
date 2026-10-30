"use client";
import { useState, useTransition } from "react";
import { CircleCheck } from "lucide-react";
import { startTrialAction } from "./actions";

const field = "w-full h-12 px-3.5 rounded-lg border border-[#C9D1CF] bg-white text-[16px] font-normal text-[var(--s-ink)] outline-none transition-colors hover:border-[#9AA5A3] focus:border-[var(--s-brand)] focus:ring-3 focus:ring-[var(--s-brand)]/15";
const FIELDS = [
  ["name", "Your name", "text", "name", true],
  ["pharmacy", "Pharmacy name", "text", "organization", true],
  ["phone", "Mobile (WhatsApp)", "tel", "tel", true],
  ["city", "City", "text", "address-level2", true],
  ["email", "Email (optional)", "email", "email", false],
] as const;

export function StartForm() {
  const [f, setF] = useState({ name: "", pharmacy: "", phone: "", city: "", email: "", website: "" });
  const [err, setErr] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [busy, start] = useTransition();

  if (done) {
    return (
      <div role="status" className="border border-[var(--s-line)] rounded-xl p-8 flex flex-col gap-3 bg-white shadow-[0_24px_48px_-28px_rgba(14,22,20,.3)] max-[640px]:p-6">
        <CircleCheck size={32} aria-hidden className="text-[var(--s-brand)]" />
        <h2 className="site-display m-0 text-[30px]">Thanks, {f.name.trim().split(" ")[0]}!</h2>
        <p className="m-0 text-[16px] text-[var(--s-ink-2)]">We’ll message you on WhatsApp at <strong>{f.phone}</strong> with the download link and next steps. Your 14-day trial starts when you create your pharmacy in Medoro.</p>
      </div>
    );
  }
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); setErr(null); start(async () => { const r = await startTrialAction(f); if (r.ok) setDone(true); else setErr(r.error); }); }}
      aria-labelledby="start-form-title" className="relative border border-[var(--s-line)] rounded-xl p-8 flex flex-col gap-4 bg-white shadow-[0_24px_48px_-28px_rgba(14,22,20,.3)] max-[640px]:p-5"
    >
      <h2 id="start-form-title" className="m-0 text-[20px] font-semibold">Your pharmacy</h2>
      {FIELDS.map(([k, label, type, auto, req]) => (
        <label key={k} className="flex flex-col gap-1.5 text-[14.5px] font-medium text-[var(--s-ink-2)]">{label}
          <input className={field} type={type} autoComplete={auto} required={req} maxLength={k === "pharmacy" ? 120 : 80} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
        </label>
      ))}
      {/* Honeypot: hidden from people, filled in by bots. */}
      <label aria-hidden className="absolute -left-[9999px] top-0 w-px h-px overflow-hidden">Website<input tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} /></label>
      {err ? <div role="alert" className="text-[15px] text-[#B3261E] bg-[#FBEAE8] rounded-lg px-3 py-2.5">{err}</div> : null}
      <button disabled={busy} className="h-12 mt-1 rounded-lg bg-[var(--s-brand)] text-white text-[16px] font-semibold cursor-pointer transition-colors hover:bg-[var(--s-brand-ink)] disabled:opacity-60 disabled:cursor-not-allowed">{busy ? "Sending…" : "Start free trial"}</button>
      <span className="text-[14px] text-[var(--s-muted)]">We use these details only to contact you about Medoro. See our <a href="/legal#privacy" className="text-[var(--s-brand)] underline underline-offset-4">privacy policy</a>.</span>
    </form>
  );
}
