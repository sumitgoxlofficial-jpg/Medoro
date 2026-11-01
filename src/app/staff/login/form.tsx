"use client";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, BadgeCheck, Check, Handshake, Headset, BadgeIndianRupee, Lock, Smartphone, User, UserPlus } from "lucide-react";
import { Wordmark } from "@/components/site/chrome";
import { staffAcceptInvite, staffEnroll, staffGooglePartner, staffSignIn, staffSignup, staffVerify } from "../actions";

type Step = "signin" | "signup" | "signupDone" | "enroll" | "totp" | "invite" | "inviteDone" | "gpartner";
const input = "border border-input rounded-lg px-3 py-[11px] text-[15px] text-ink outline-none focus:border-teal bg-white w-full";
const label = "flex flex-col gap-[5px] text-[13px] text-muted";

export function StaffLogin({ domain, invite, pending, joinPartner = false, google = false, googleNew = null, notice = "", handoff = false }: {
  domain: string; invite: { token: string; info: { name: string; email: string } | null } | null; pending: { email: string; enrolled: boolean } | null;
  joinPartner?: boolean; google?: boolean; googleNew?: { email: string; name: string } | null; notice?: string; handoff?: boolean;
}) {
  const router = useRouter();
  const [step, setStep] = useState<Step>(googleNew ? "gpartner" : invite ? "invite" : pending ? (pending.enrolled ? "totp" : "enroll") : joinPartner ? "signup" : "signin");
  const [email, setEmail] = useState(pending?.email ?? "");
  const [pwd, setPwd] = useState("");
  const [code, setCode] = useState("");
  const [qr, setQr] = useState<{ qr: string; secret: string } | null>(null);
  const [err, setErr] = useState(notice);
  const [gp, setGp] = useState({ name: googleNew?.name ?? "", phone: "", team: "" });
  const [busy, start] = useTransition();
  const [su, setSu] = useState({ name: "", email: "", phone: "", team: "", password: "", role: (joinPartner ? "partner" : "sales") as "sales" | "care" | "partner" });
  const partner = su.role === "partner";
  const [doneText, setDoneText] = useState("");

  // Signed in with Google: the session cookie is SameSite=Strict, so continue with a same-site navigation.
  useEffect(() => { if (handoff) window.location.replace("/staff"); }, [handoff]);
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
      if (r.data.active && r.data.role === "partner") {
        // Partners don't wait for approval: sign straight in.
        const a = await staffSignIn(su.email, su.password);
        if (a.ok && a.data.next === "done") { router.replace("/staff"); router.refresh(); return; }
      }
      setDoneText(r.data.bootstrap ? "You’re the first super admin. Sign in to set up your authenticator." : su.role === "partner" ? "Thanks for joining. Medoro reviews your profile, usually within a day. Once approved, sign in here to get your referral code and see your earnings." : su.role === "sales" ? "Your sales profile is waiting for super admin approval. Your referral code appears in the console once approved." : "Your customer care profile is waiting for super admin approval.");
      setEmail(su.email); setStep("signupDone");
    } else if (step === "gpartner") {
      const r = await staffGooglePartner(gp);
      if (!r.ok) return setErr(r.error);
      router.replace("/staff"); router.refresh();
    } else if (step === "signupDone" || step === "inviteDone") {
      setStep("signin");
    } else if (step === "invite") {
      const r = await staffAcceptInvite(invite!.token, pwd);
      if (!r.ok) return setErr(r.error);
      setEmail(r.data.email); setPwd(""); setStep("inviteDone");
    }
  });

  const label1 = { signin: "Continue", signup: partner ? "Create partner account" : "Submit for approval", gpartner: "Create partner account", signupDone: "Back to sign in", enroll: "Verify and finish", totp: "Verify", invite: "Set password", inviteDone: "Sign in" }[step];
  const gBtn = (text: string) => google ? (
    <a href="/api/auth/google/start?intent=partner" className="flex items-center justify-center gap-2.5 border border-input bg-white rounded-[10px] py-[11px] text-[14px] font-semibold text-ink no-underline cursor-pointer hover:border-teal hover:text-ink"><GoogleG />{text}</a>
  ) : null;
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

            {handoff ? <div className="text-[14px] text-muted py-2">Signing you in…</div> : null}

            {step === "gpartner" && googleNew ? (
              <>
                <span className="text-[14px] font-semibold">Create your partner account</span>
                <div className="bg-[#F7F8F9] border border-[#EEF0F2] rounded-lg px-3 py-2.5 text-[13px] text-ink-2 flex gap-2 items-center"><GoogleG /><span className="flex-1 min-w-0 truncate">{googleNew.email}</span></div>
                {([["name", "Full name", "text", "name"], ["phone", "Mobile (for payouts and WhatsApp)", "tel", "tel"], ["team", "Company / area (e.g. MR at Cipla, Pune)", "text", "off"]] as const).map(([k, l, t, ac]) => (
                  <label key={k} className={label}>{l}<input className={input} type={t} autoComplete={ac} value={gp[k]} onChange={(e) => { setGp((x) => ({ ...x, [k]: e.target.value })); setErr(""); }} /></label>
                ))}
                <span className="text-[12.5px] text-muted">No password needed. Next time, tap “Continue with Google”.</span>
              </>
            ) : null}

            {step === "signin" && !handoff ? (
              <>
                {gBtn("Partners: continue with Google")}
                {google ? <div className="flex items-center gap-2.5 text-[12px] text-faint"><span className="h-px flex-1 bg-line" />or with email<span className="h-px flex-1 bg-line" /></div> : null}
                <label className={label}>Email<input className={input} value={email} onChange={(e) => { setEmail(e.target.value.trim()); setErr(""); }} placeholder={domain === "*" ? "you@example.com" : `name@${domain} or your partner email`} autoComplete="username" inputMode="email" /></label>
                <label className={label}>Password<input className={input} type="password" value={pwd} onChange={(e) => { setPwd(e.target.value); setErr(""); }} autoComplete="current-password" /></label>
                <div className="flex justify-end -mt-1.5 text-[13px]"><button type="button" onClick={() => setErr("Password resets go through a super admin. Ask them to reset your sign-in; you’ll get a new link.")} className="min-h-10 inline-flex items-center text-teal cursor-pointer">Forgot password?</button></div>
              </>
            ) : null}

            {step === "signup" ? (
              <>
                <span className="text-[14px] font-semibold">{partner ? "Become a reference partner" : "Create your profile"}</span>
                <span className="text-[13px] text-muted">{partner ? "For MRs, distributors and consultants. Refer pharmacies to Medoro and earn commission on every plan they buy. Your account is ready straight away." : "A super admin reviews every new profile. Sales profiles get a referral code and earn commission on each product sold."}</span>
                {partner && google ? <>{gBtn("Continue with Google")}<div className="flex items-center gap-2.5 text-[12px] text-faint"><span className="h-px flex-1 bg-line" />or fill in your details<span className="h-px flex-1 bg-line" /></div></> : null}
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
            {!handoff && (step !== "invite" || invite?.info) ? (
              <button type="submit" disabled={busy} className="bg-teal text-white rounded-[10px] p-3 text-[15px] font-semibold cursor-pointer flex gap-2 items-center justify-center disabled:opacity-60">{busy ? "Please wait…" : label1}</button>
            ) : null}
            {step === "signin" && !handoff ? <button type="button" onClick={() => { setStep("signup"); setErr(""); }} className="self-center min-h-10 inline-flex items-center gap-1.5 text-[14px] font-semibold text-teal cursor-pointer"><UserPlus size={15} />New here? Create your profile</button> : null}
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

function GoogleG() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true" className="flex-none">
      <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z" />
    </svg>
  );
}
