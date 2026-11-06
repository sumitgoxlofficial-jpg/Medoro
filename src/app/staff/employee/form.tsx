"use client";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { ArrowLeft, Clock, PhoneCall } from "lucide-react";
import { Wordmark } from "@/components/site/chrome";
import { staffGoogleEmployee } from "../actions";
import { GoogleG } from "../login/form";

const field = "border border-input rounded-[10px] px-3 py-[10px] text-[15px] outline-none bg-white focus:border-teal w-full";
const label = "flex flex-col gap-[5px] text-[13px] text-muted";

export function EmployeeLogin({ google, handoff = false, newProfile = null, notice = "", waiting = false }: { google: boolean; handoff?: boolean; newProfile?: { email: string; name: string } | null; notice?: string; waiting?: boolean }) {
  const [busy, start] = useTransition();
  const [err, setErr] = useState("");
  const [done, setDone] = useState(false);
  const [f, setF] = useState({ name: newProfile?.name ?? "", phone: "", team: "", agree: false });
  useEffect(() => { if (handoff) window.location.replace("/staff/growth/my-work"); }, [handoff]);
  const submit = (e: React.FormEvent) => {
    e.preventDefault(); setErr("");
    start(async () => { const r = await staffGoogleEmployee({ ...f, agree: f.agree as true }); if (r.ok) setDone(true); else setErr(r.error); });
  };
  const gBtn = (text: string) => google ? <a href="/api/auth/google/start?intent=employee" className="flex items-center justify-center gap-2.5 border border-input bg-white rounded-[10px] py-[12px] text-[15px] font-semibold text-ink no-underline hover:border-teal"><GoogleG />{text}</a> : null;

  return (
    <div className="min-h-dvh bg-[#F5F6F7] text-ink flex flex-col leading-[1.45]">
      <header className="h-[68px] flex items-center gap-4 px-[clamp(16px,3vw,32px)] border-b border-[#E6E8EB] bg-white">
        <Link href="/" className="no-underline"><Wordmark size={22} /></Link>
        <span className="h-6 px-2.5 rounded-full bg-[#0E1A1F] text-white text-[11.5px] font-semibold tracking-[.08em] uppercase flex items-center">Employee</span>
        <Link href="/" className="ml-auto text-[14px] font-semibold text-ink-2 flex gap-1.5 items-center whitespace-nowrap"><ArrowLeft size={15} />medoro.in</Link>
      </header>
      <main className="flex-1 flex items-center justify-center px-4 py-[clamp(24px,5vh,56px)]">
        <div className="w-[min(440px,100%)] flex flex-col gap-4">
          <section className="bg-white border border-line rounded-[14px] p-7 flex flex-col gap-4 shadow-[0_1px_2px_rgba(16,24,40,.04)] max-[400px]:p-5">
            <div className="flex gap-3 items-center">
              <span className="size-10 rounded-[10px] bg-[#0E1A1F] text-[#5FD3BC] flex items-center justify-center flex-none"><PhoneCall size={20} /></span>
              <div className="flex flex-col leading-[1.3]"><h1 className="m-0 text-[20px] font-semibold">Sales employee sign in</h1><span className="text-[13px] text-muted">Your assigned pharmacies, calls and follow-ups</span></div>
            </div>

            {handoff ? <div className="text-[14px] text-muted py-2">Signing you in…</div>
            : done || waiting ? (
              <div className="flex flex-col gap-2 py-1" role="status">
                <div className="flex gap-2 items-center font-semibold text-[15px]"><Clock size={18} className="text-[#94570A]" />Waiting for approval</div>
                <p className="m-0 text-[14px] text-muted">{done ? "Your profile was created. " : ""}A Medoro admin checks and approves new employees. Once approved, come back here and tap “Continue with Google” to start work.</p>
              </div>
            ) : newProfile ? (
              <form onSubmit={submit} className="flex flex-col gap-3">
                <p className="m-0 text-[14px]">Create your employee profile for <strong>{newProfile.email}</strong>. A Medoro admin approves it before you can sign in.</p>
                <label className={label}>Full name<input required className={field} value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoComplete="name" /></label>
                <label className={label}>Mobile number<input required className={field} inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} autoComplete="tel" placeholder="98765 43210" /></label>
                <label className={label}>Area or team (optional)<input className={field} value={f.team} onChange={(e) => setF({ ...f, team: e.target.value })} placeholder="e.g. Pune West" /></label>
                <label className="flex gap-2 items-start text-[13px]"><input type="checkbox" className="mt-1" checked={f.agree} onChange={(e) => setF({ ...f, agree: e.target.checked })} /><span>I work for Medoro as a sales employee. I’ll use pharmacy contact details only for Medoro’s work, respect do-not-contact requests, and report calls truthfully.</span></label>
                {err ? <div className="text-[13.5px] text-[#B3261E]" role="alert">{err}</div> : null}
                <button disabled={busy || !f.agree} className="bg-teal text-white rounded-[10px] py-[12px] text-[15px] font-semibold disabled:opacity-60">{busy ? "Sending…" : "Send for approval"}</button>
              </form>
            ) : (
              <div className="flex flex-col gap-3">
                {notice ? <div className="text-[13.5px] rounded-lg bg-[#FFF4E0] text-[#94570A] px-3 py-2" role="alert">{notice}</div> : null}
                {google ? gBtn("Continue with Google") : <div className="text-[14px] text-muted">Google sign-in isn’t set up on this server yet. Ask your admin.</div>}
                <p className="m-0 text-[12.5px] text-muted">New here? Continue with Google to create your profile; an admin approves it. No password needed.</p>
              </div>
            )}
          </section>
          <div className="text-[12.5px] text-muted text-center">Admin, manager or customer care? <Link href="/staff/login?as=team" className="text-teal font-semibold">Medoro team sign in</Link></div>
        </div>
      </main>
    </div>
  );
}
