"use client";
import { useState, useTransition } from "react";
import { CircleCheck } from "lucide-react";
import { startTrialAction } from "./actions";

const field = "w-full h-11 px-3.5 rounded-[9px] border border-[#D9DDE1] bg-white text-[15px] outline-none focus:border-teal focus:ring-2 focus:ring-teal/15";
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
      <div role="status" className="border border-[#E6E8EB] rounded-2xl p-7 flex flex-col gap-3 shadow-[0_10px_30px_-18px_rgba(16,24,40,.25)]">
        <CircleCheck size={32} className="text-teal" />
        <h2 className="m-0 text-[22px] font-bold">Thanks, {f.name.trim().split(" ")[0]}!</h2>
        <p className="m-0 text-[15px] text-[#4B535B]">We’ll message you on WhatsApp at <strong>{f.phone}</strong> with the download link and next steps. Your 14-day trial starts when you create your pharmacy in Medoro.</p>
      </div>
    );
  }
  return (
    <form
      onSubmit={(e) => { e.preventDefault(); setErr(null); start(async () => { const r = await startTrialAction(f); if (r.ok) setDone(true); else setErr(r.error); }); }}
      className="relative border border-[#E6E8EB] rounded-2xl p-7 flex flex-col gap-3.5 shadow-[0_10px_30px_-18px_rgba(16,24,40,.25)]"
    >
      {FIELDS.map(([k, label, type, auto, req]) => (
        <label key={k} className="flex flex-col gap-1.5 text-[13.5px] font-semibold text-[#3D454D]">{label}
          <input className={field} type={type} autoComplete={auto} required={req} maxLength={k === "pharmacy" ? 120 : 80} value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} />
        </label>
      ))}
      {/* Honeypot: hidden from people, filled in by bots. */}
      <label aria-hidden className="absolute -left-[9999px] top-0 w-px h-px overflow-hidden">Website<input tabIndex={-1} autoComplete="off" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} /></label>
      {err ? <div role="alert" className="text-[14px] text-[#B3261E] bg-[#FBEAE8] rounded-lg px-3 py-2">{err}</div> : null}
      <button disabled={busy} className="h-12 rounded-[10px] bg-teal text-white text-[15.5px] font-semibold cursor-pointer hover:bg-teal-hover disabled:opacity-60">{busy ? "Sending…" : "Start free trial"}</button>
      <span className="text-[12.5px] text-[#6B737B]">We use these details only to contact you about Medoro. See our <a href="/legal#privacy" className="text-teal">privacy policy</a>.</span>
    </form>
  );
}
