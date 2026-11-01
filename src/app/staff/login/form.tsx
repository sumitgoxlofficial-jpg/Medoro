"use client";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, BadgeCheck, Check, Handshake, Headset, BadgeIndianRupee, Lock, Smartphone, User, UserPlus } from "lucide-react";
import { Wordmark } from "@/components/site/chrome";
import { staffAcceptInvite, staffEnroll, staffSignIn, staffSignup, staffVerify } from "../actions";

type Step = "signin" | "signup" | "signupDone" | "enroll" | "totp" | "invite" | "inviteDone";
const input = "border border-input rounded-lg px-3 py-[11px] text-[15px] text-ink outline-none focus:border-teal bg-white w-full";
const label = "flex flex-col gap-[5px] text-[13px] text-muted";

export function StaffLogin({ domain, invite, pending, joinPartner = false }: { domain: string; invite: { token: string; info: { name: string; email: string } | null } | null; pending: { email: string; enrolled: boolean } | null; joinPartner?: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(invite ? "invite" : pending ? (pending.enrolled ? "totp" : "enroll") : joinPartner ? "signup" : "signin");
  const [email, setEmail] = useState(pending?.email ?? "");
  const [pwd, setPwd] = useState("");
  const [code, setCode] = useState("");
  const [qr, setQr] = useState<{ qr: string; secret: string } | null>(null);
  const [err, setErr] = useState("");
  const [busy, start] = useTransition();
  const [su, setSu] = useState({ name: "", email: "", phone: "", team: "", password: "", role: (joinPartner ? "partner" : "sales") as "sales" | "care" | "partner" });
  const partner = su.role === "partner";
  const [doneText, setDoneText] = useState("");

  useEffect(() => {
    if (step === "enroll" && !qr) start(async () => { const r = await staffEnroll(); if (r.ok) setQr(r.data); else setErr(r.error); });
  }, [step, qr]);

  const primary = () => start(async () => {
    setErr("");
    if (step === "signin") {
      const r = await staffSignIn(email, pwd);
      if (!r.ok) return setErr(r.error);
      setPwd("");
      if (r.data.next === "done") { router.replace("/staff"); router.refresh(); return; }
      setStep(r.data.next);
    } else if (step === "enroll" || step === "totp") {
      const r = await staffVerify(code);
      if (!r.ok) return setErr(r.error);
      router.replace("/staff"); router.refresh();
    } else if (step === "signup") {
      const r = await staffSignup(su);
      if (!r.ok) return setErr(r.error);
      setDoneText(r.data.bootstrap ? "You’re the first super admin. Sign in to set up your authenticator." : su.role === "partner" ? "Thanks for joining. Medoro reviews your profile, usually within a day. Once approved, sign in here to get your referral code and see your earnings." : su.role === "sales" ? "Your sales profile is waiting for super admin approval. Your referral code appears in the console once approved." : "Your customer care profile is waiting for super admin approval.");
      setEmail(su.email); setStep("signupDone");
    } else if (step === "signupDone" || step === "inviteDone") {
      setStep("signin");
    } else if (step === "invite") {
      const r = await staffAcceptInvite(invite!.token, pwd);
      if (!r.ok) return setErr(r.error);
      setEmail(r.data.email); setPwd(""); setStep("inviteDone");
    }
  });

  const label1 = { signin: "Continue", signup: "Submit for approval", signupDone: "Back to sign in", enroll: "Verify and finish", totp: "Verify", invite: "Set password", inviteDone: "Sign in" }[step];
  const opt = (on: boolean) => `rounded-lg p-2.5 text-[13px] font-semibold cursor-pointer flex gap-1.5 items-center justify-center ${on ? "border-[1.5px] border-teal bg-teal-tint text-teal" : "border border-input bg-white text-ink"}`;

  return (
    <div className="min-h-dvh bg-[#F5F6F7] text-ink flex flex-col leading-[1.45]">
      <header className="h-[68px] flex items-center gap-4 px-[clamp(16px,3vw,32px)] border-b border-[#E6E8EB] bg-white">
        <Link href="/" className="no-underline"><Wordmark size={22} /></Link>
        <span className="h-6 px-2.5 rounded-full bg-[#0E1A1F] text-white text-[11.5px] font-semibold tracking-[.08em] uppercase flex items-center">Staff</span>
        <Link href="/" className="ml-auto text-[14px] font-semibold text-ink-2 flex gap-1.5 items-center whitespace-nowrap hover:text-ink-strong"><ArrowLeft size={15} />medoro.in</Link>
      </header>
      <main className="flex-1 flex items-center justify-center px-4 py-[clamp(24px,5vh,56px)]">
        <div className="w-[min(440px,100%)] flex flex-col gap-4">
          <form onSubmit={(e) => { e.preventDefault(); primary(); }} className="bg-white border border-line rounded-[14px] p-7 flex flex-col gap-3.5 shadow-[0_1px_2px_rgba(16,24,40,.04)] max-[400px]:p-5">
            <div className="flex gap-3 items-center">
              <span className="size-10 rounded-[10px] bg-[#0E1A1F] text-[#5FD3BC] flex items-center justify-center flex-none"><BadgeCheck size={20} /></span>
              <div className="flex flex-col leading-[1.3]"><h1 className="m-0 text-[20px] font-semibold">Sales & partner sign in</h1><span className="text-[13px] text-muted">Medoro sales, customer care and reference partners</span></div>
            </div>

            {step === "signin" ? (
              <>
                <label className={label}>Email<input className={input} value={email} onChange={(e) => { setEmail(e.target.value.trim()); setErr(""); }} placeholder={domain === "*" ? "you@example.com" : `name@${domain} or your partner email`} autoComplete="username" inputMode="email" /></label>
                <label className={label}>Password<input className={input} type="password" value={pwd} onChange={(e) => { setPwd(e.target.value); setErr(""); }} autoComplete="current-password" /></label>
                <div className="flex justify-end -mt-1.5 text-[13px]"><button type="button" onClick={() => setErr("Password resets go through a super admin. Ask them to reset your sign-in; you’ll get a new link.")} className="min-h-10 inline-flex items-center text-teal cursor-pointer">Forgot password?</button></div>
              </>
            ) : null}

            {step === "signup" ? (
              <>
                <span className="text-[14px] font-semibold">{partner ? "Become a reference partner" : "Create your profile"}</span>
                <span className="text-[13px] text-muted">{partner ? "For MRs, distributors and consultants. Refer pharmacies to Medoro and earn commission on every plan they buy. Medoro reviews each profile." : "A super admin reviews every new profile. Sales profiles get a referral code and earn commission on each product sold."}</span>
                <div className="flex flex-col gap-1.5"><span className="text-[13px] text-muted">I am joining as</span>
                  <div className="grid grid-cols-3 gap-1.5 max-[400px]:grid-cols-1">
                    <button type="button" onClick={() => setSu((x) => ({ ...x, role: "partner" }))} className={opt(su.role === "partner")}><Handshake size={15} />Reference partner</button>
                    <button type="button" onClick={() => setSu((x) => ({ ...x, role: "sales" }))} className={opt(su.role === "sales")}><BadgeIndianRupee size={15} />Medoro sales</button>
                    <button type="button" onClick={() => setSu((x) => ({ ...x, role: "care" }))} className={opt(su.role === "care")}><Headset size={15} />Customer care</button>
                  </div>
                </div>
                {([["name", "Full name", "text", "name"], ["email", partner ? "Email" : "Work email", "email", "email"], ["phone", "Mobile", "tel", "tel"], ["team", partner ? "Company / area (e.g. MR at Cipla, Pune)" : "Team / city", "text", "off"], ["password", "Create a password (12+ characters)", "password", "new-password"]] as const).map(([k, l, t, ac]) => (
                  <label key={k} className={label}>{l}<input className={input} type={t} autoComplete={ac} value={su[k]} onChange={(e) => { setSu((x) => ({ ...x, [k]: e.target.value })); setErr(""); }} placeholder={k === "email" ? (partner || domain === "*" ? "you@gmail.com" : `name@${domain}`) : ""} /></label>
                ))}
              </>
            ) : null}

            {step === "signupDone" || step === "inviteDone" ? (
              <div className="flex flex-col items-center text-center gap-2 py-1.5">
                <span className="size-12 rounded-full bg-[#E7F6EE] text-[#18794E] flex items-center justify-center"><Check size={24} /></span>
                <strong className="text-[17px]">{step === "signupDone" ? "Profile submitted" : "Password set"}</strong>
                <span className="text-[14px] text-muted">{step === "signupDone" ? doneText : "Sign in now. You’ll set up an authenticator app on the next step."}</span>
              </div>
            ) : null}

            {step === "invite" ? (
              invite?.info ? (
                <>
                  <div className="bg-[#F7F8F9] border border-[#EEF0F2] rounded-lg px-3 py-2.5 text-[13px] text-ink-2 flex gap-2 items-center"><User size={15} className="text-muted" /><span className="truncate">{invite.info.name} · {invite.info.email}</span></div>
                  <label className={label}>Choose a password (12+ characters)<input className={input} type="password" autoComplete="new-password" value={pwd} onChange={(e) => { setPwd(e.target.value); setErr(""); }} /></label>
                </>
              ) : <div className="text-[14px] text-muted">This invite link has expired or was already used. Ask a super admin for a new one.</div>
            ) : null}

            {step === "enroll" || step === "totp" ? (
              <>
                <div className="bg-[#F7F8F9] border border-[#EEF0F2] rounded-lg px-3 py-2.5 text-[13px] text-ink-2 flex gap-2 items-center"><User size={15} className="text-muted" /><span className="flex-1 min-w-0 truncate">{email}</span></div>
                <span className="text-[14px] font-semibold flex gap-1.5 items-center"><Smartphone size={15} />{step === "enroll" ? "Set up your authenticator" : "Confirm it’s you"}</span>
                {step === "enroll" ? (
                  <div className="flex flex-col items-center gap-2 p-3.5 border border-dashed border-input rounded-[10px] text-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    {qr ? <img src={qr.qr} alt="Authenticator QR code" width={180} height={180} /> : <div className="size-[180px] bg-chip rounded animate-pulse" />}
                    <span className="text-[12.5px] text-ink-2">Scan with Google Authenticator, Microsoft Authenticator or 1Password, then enter the 6-digit code.</span>
                    {qr ? <code className="text-[11.5px] text-muted break-all">{qr.secret}</code> : null}
                  </div>
                ) : null}
                <label className={label}>6-digit code from your authenticator<input className={input + " font-mono text-[18px] tracking-[.3em]"} value={code} onChange={(e) => { setCode(e.target.value.replace(/\D/g, "").slice(0, 6)); setErr(""); }} inputMode="numeric" autoComplete="one-time-code" autoFocus /></label>
              </>
            ) : null}

            {err ? <div role="alert" className="text-[13px] text-[#B3261E]">{err}</div> : null}
            {step !== "invite" || invite?.info ? (
              <button type="submit" disabled={busy} className="bg-teal text-white rounded-[10px] p-3 text-[15px] font-semibold cursor-pointer flex gap-2 items-center justify-center disabled:opacity-60">{busy ? "Please wait…" : label1}</button>
            ) : null}
            {step === "signin" ? <button type="button" onClick={() => { setStep("signup"); setErr(""); }} className="self-center min-h-10 inline-flex items-center gap-1.5 text-[14px] font-semibold text-teal cursor-pointer"><UserPlus size={15} />New here? Create your profile</button> : null}
            {step === "signup" ? <button type="button" onClick={() => { setStep("signin"); setErr(""); }} className="self-center min-h-10 inline-flex items-center text-[13px] text-teal cursor-pointer">Back to sign in</button> : null}
            <div className="text-[11.5px] text-faint text-center">Medoro team members also use an authenticator app · every sign-in is audited</div>
          </form>

          <div className="flex gap-2.5 items-start bg-white border border-[#E6E8EB] rounded-xl px-4 py-3.5 text-[13px] text-ink-2">
            <Lock size={16} className="text-teal mt-0.5 flex-none" />
            <span>Staff accounts see accounts, plans and support tickets only. <strong className="font-semibold">They cannot open any pharmacy’s database, invoices or backups.</strong> Access to a customer environment needs that pharmacy owner’s time-limited approval.</span>
          </div>
          <div className="flex justify-center gap-4 flex-wrap text-[13px]">
            <Link href="/partners" className="whitespace-nowrap">About the reference partner programme</Link>
            <Link href="/signin" className="whitespace-nowrap">Pharmacy owner sign in</Link>
            <Link href="/signin?view=employee" className="whitespace-nowrap">Pharmacy staff sign in</Link>
          </div>
        </div>
      </main>
    </div>
  );
}
