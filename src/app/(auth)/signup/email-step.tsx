"use client";
import Link from "next/link";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Mail } from "lucide-react";
import { sendSignupEmailCode, verifySignupEmailCode } from "../actions";

const inp = "border border-input rounded-[10px] px-3.5 py-3 text-[15px] text-ink outline-none focus:border-teal bg-white w-full";

/** Sign-up with email: confirm the address with a 6-digit code, then the pharmacy form opens. */
export function EmailStep({ back }: { back: string | null }) {
  const router = useRouter();
  const [email, setEmail] = useState(""), [code, setCode] = useState(""), [sent, setSent] = useState(false);
  const [err, setErr] = useState(""), [busy, start] = useTransition();
  const submit = (e: React.FormEvent) => {
    e.preventDefault(); setErr("");
    start(async () => {
      if (!sent) {
        const r = await sendSignupEmailCode(email);
        if (!r.ok) return setErr(r.error);
        setSent(true);
      } else {
        const r = await verifySignupEmailCode(email, code);
        if (!r.ok) return setErr(r.error);
        router.refresh();
      }
    });
  };
  return (
    <form onSubmit={submit} className="bg-white border border-[#E3E6E9] rounded-[14px] p-7 flex flex-col gap-3.5 w-[min(420px,100%)]">
      <div className="flex gap-2.5 items-center"><span className="size-9 rounded-lg bg-teal-tint text-teal flex items-center justify-center"><Mail size={18} /></span><strong className="text-[16px]">Sign up with email</strong></div>
      <label className="flex flex-col gap-1.5 text-[13px] text-muted">Your email
        <input className={inp + (sent ? " bg-page text-muted" : "")} type="email" value={email} onChange={(e) => { setEmail(e.target.value); setErr(""); }} readOnly={sent} placeholder="you@pharmacy.in" autoComplete="email" autoFocus />
      </label>
      {sent ? (
        <>
          <div className="text-[13px] text-ink-2 bg-teal-tint border border-teal-line rounded-lg px-3 py-2.5">We sent a 6-digit code to <strong>{email.trim()}</strong>. Check your inbox (and spam).</div>
          <label className="flex flex-col gap-1.5 text-[13px] text-muted">6-digit code
            <input className={inp + " font-mono text-[18px] tracking-[.3em]"} value={code} onChange={(e) => { setCode(e.target.value.replace(/\D/g, "").slice(0, 6)); setErr(""); }} inputMode="numeric" autoComplete="one-time-code" autoFocus />
          </label>
        </>
      ) : <div className="text-[13px] text-muted">We’ll send a code to confirm it’s yours. Then you add your pharmacy details.</div>}
      {err ? <div role="alert" className="text-[13px] text-[#B3261E]">{err}</div> : null}
      <button type="submit" disabled={busy || (sent && code.length !== 6)} className="bg-teal text-white rounded-[10px] p-3 text-[15px] font-semibold cursor-pointer disabled:opacity-60">{busy ? "Please wait…" : sent ? "Confirm and continue" : "Send code"}</button>
      {sent ? <button type="button" onClick={() => { setSent(false); setCode(""); setErr(""); }} className="self-center min-h-10 text-[13px] text-teal cursor-pointer">Use a different email or resend</button> : null}
      {back ? <Link href={back} className="self-center min-h-10 inline-flex items-center text-[13px] text-teal">Back to Continue with Google</Link> : null}
    </form>
  );
}
