"use client";
import Link from "next/link";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeft, BadgeCheck, BadgeIndianRupee, BarChart3, Check, Handshake, Lock, Smartphone, User, UserPlus, Wallet } from "lucide-react";
import { Wordmark } from "@/components/site/chrome";
import { ReferralArt } from "@/components/site/decor";
import { SideIcons } from "../employee/art";
import { staffAcceptInvite, staffEnroll, staffGooglePartner, staffSendPartnerCode, staffSignIn, staffSignup, staffVerify, staffVerifyPartnerCode } from "../actions";

type Step = "signin" | "signup" | "signupDone" | "enroll" | "totp" | "invite" | "inviteDone" | "gpartner";
const input = "border border-input rounded-lg px-3 py-[11px] text-[15px] text-ink outline-none focus:border-teal bg-white w-full";
const label = "flex flex-col gap-[5px] text-[13px] text-muted";

export function StaffLogin({ invite, pending, joinPartner = false, google = false, googleNew = null, notice = "", handoff = false, setupOpen = false, emailCodes = false }: {
  domain: string; invite: { token: string; info: { name: string; email: string } | null } | null; pending: { email: string; enrolled: boolean } | null;
  joinPartner?: boolean; google?: boolean; googleNew?: { email: string; name: string } | null; notice?: string; handoff?: boolean;
  setupOpen?: boolean; emailCodes?: boolean;
}) {
  const router = useRouter();
  // This page signs in reference partners. The Medoro team signs in on the HRMS (/staff/employee); super admins and
  // care come back here only to confirm their authenticator for the staff console. `mode` picks what "create" makes:
  // a partner account, or (on a fresh server) the first super admin.
  const [mode, setMode] = useState<"partner" | "team">(pending ? "team" : "partner");
  const [step, setStep] = useState<Step>(googleNew ? "gpartner" : invite ? "invite" : pending ? (pending.enrolled ? "totp" : "enroll") : joinPartner ? "signup" : "signin");
  const [email, setEmail] = useState(pending?.email ?? "");
  const [pwd, setPwd] = useState("");
  const [code, setCode] = useState("");
  const [qr, setQr] = useState<{ qr: string; secret: string } | null>(null);
  const [err, setErr] = useState(notice);
  const [gp, setGp] = useState({ name: googleNew?.name ?? "", phone: "", team: "" });
  const [busy, start] = useTransition();
  const [su, setSu] = useState({ name: "", email: "", phone: "", team: "", password: "", role: "partner" as "partner" | "sales" });
  // Partners who join with email confirm it with a 6-digit code (when this server can send email).
  const [codeSent, setCodeSent] = useState(false), [ecode, setEcode] = useState("");
  const needCode = emailCodes && mode === "partner";
  const sendCode = () => start(async () => {
    setErr("");
    const r = await staffSendPartnerCode(su.email);
    if (!r.ok) return setErr(r.error);
    setCodeSent(true);
  });
  const [doneText, setDoneText] = useState("");

  // Signed in with Google: the session cookie is SameSite=Strict, so continue with a same-site navigation.
  useEffect(() => { if (handoff) window.location.replace("/staff"); }, [handoff]);
  useEffect(() => {
    if (step === "enroll" && !qr) start(async () => { const r = await staffEnroll(); if (r.ok) setQr(r.data); else setErr(r.error); });
  }, [step, qr]);

  const primary = () => start(async () => {
    setErr("");
    if (step === "signin") {
      const r = await staffSignIn(email, pwd, "partner");
      if (!r.ok) return setErr(r.error);
      setPwd("");
      if (r.data.next === "done") { router.replace("/staff"); router.refresh(); return; }
      setStep(r.data.next);
    } else if (step === "enroll" || step === "totp") {
      const r = await staffVerify(code);
      if (!r.ok) return setErr(r.error);
      router.replace("/staff"); router.refresh();
    } else if (step === "signup") {
      if (needCode) {
        if (!codeSent) return setErr("Tap “Send code” and enter the code we email you.");
        const v = await staffVerifyPartnerCode(su.email, ecode);
        if (!v.ok) return setErr(v.error);
      }
      const r = await staffSignup(su);
      if (!r.ok) return setErr(r.error);
      if (r.data.active && r.data.role === "partner") {
        // Partners don't wait for approval: sign straight in.
        const a = await staffSignIn(su.email, su.password, "partner");
        if (a.ok && a.data.next === "done") { router.replace("/staff"); router.refresh(); return; }
      }
      setDoneText(r.data.bootstrap ? "You’re the first super admin. Sign in on the Medoro HRMS, then open the Staff console to set up your authenticator." : "You’re in. Sign in to get your referral code and see your earnings.");
      setEmail(su.email); setStep("signupDone");
    } else if (step === "gpartner") {
      const r = await staffGooglePartner(gp);
      if (!r.ok) return setErr(r.error);
      router.replace("/staff"); router.refresh();
    } else if (step === "inviteDone") {
      router.push("/staff/employee");
    } else if (step === "signupDone") {
      if (mode === "team") return router.push("/staff/employee");
      setStep("signin");
    } else if (step === "invite") {
      const r = await staffAcceptInvite(invite!.token, pwd);
      if (!r.ok) return setErr(r.error);
      setEmail(r.data.email); setPwd(""); setStep("inviteDone");
    }
  });

  const label1 = { signin: "Continue", signup: mode === "team" ? "Create admin profile" : "Create partner account", gpartner: "Create partner account", signupDone: mode === "team" ? "Go to HRMS sign-in" : "Back to sign in", enroll: "Verify and finish", totp: "Verify", invite: "Set password", inviteDone: "Sign in" }[step];
  const gBtn = (text: string) => google ? (
    <a href="/api/auth/google/start?intent=partner" className="flex items-center justify-center gap-2.5 border border-input bg-white rounded-[10px] py-[11px] text-[14px] font-semibold text-ink no-underline cursor-pointer transition-[border-color,box-shadow,transform] duration-300 hover:border-teal hover:text-ink hover:-translate-y-0.5 hover:shadow-[0_10px_20px_-14px_rgba(11,94,91,.6)]"><GoogleG />{text}</a>
  ) : null;
  
  return (
    <div className="hr-motion min-h-dvh bg-[#F5F6F7] text-ink flex flex-col leading-[1.45]">
      <header className="relative z-10 h-[68px] flex items-center gap-4 px-[clamp(16px,3vw,32px)] border-b border-[#E6E8EB] bg-white/90 backdrop-blur">
        <Link href="/" className="no-underline"><Wordmark size={22} /></Link>
        <span className="h-6 px-2.5 rounded-full bg-[#0B5E5B] text-white text-[11.5px] font-semibold tracking-[.08em] uppercase flex items-center gap-1"><Handshake size={13} aria-hidden />Partner</span>
        <Link href="/partners" className="ml-auto max-[640px]:hidden text-[14px] font-semibold text-teal whitespace-nowrap hover:text-teal-hover">Partner programme</Link>
        <Link href="/" className="max-[640px]:ml-auto text-[14px] font-semibold text-ink-2 flex gap-1.5 items-center whitespace-nowrap hover:text-ink-strong"><ArrowLeft size={15} />medoro.in</Link>
      </header>
      <main className="flex-1 grid min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
        {/* Left: what partners get, with the referral illustration. */}
        <aside className="relative overflow-hidden bg-[#0B5E5B] text-white px-[clamp(32px,4vw,64px)] py-12 flex-col justify-center gap-7 hidden min-[1100px]:flex">
          <div aria-hidden className="pointer-events-none absolute inset-0">
            <div className="hr-dots absolute inset-0" />
            <div className="site-blob site-blob-a bg-[#14B8A6]/30" />
            <div className="site-blob site-blob-b bg-[#F5C451]/15" />
          </div>
          <div className="relative flex flex-col gap-3 max-w-[520px]">
            <span className="hr-up text-[12px] font-bold uppercase tracking-[.1em] text-[#5EEAD4]">Medoro reference partners</span>
            <h2 className="hr-up [--d:1] m-0 text-[clamp(30px,2.6vw,40px)] leading-[1.12] font-bold"><span className="hr-shine">Recommend Medoro. Earn on every plan they buy.</span></h2>
            <p className="hr-up [--d:2] m-0 text-[15.5px] text-white/70">For medical representatives, distributors and pharmacy consultants.</p>
          </div>
          <div className="relative hr-up [--d:3] max-w-[440px] w-full"><ReferralArt className="w-full h-auto drop-shadow-[0_24px_40px_rgba(0,0,0,.28)]" /></div>
          <ul className="relative m-0 p-0 list-none flex flex-col gap-3 max-w-[520px]">
            {([[BadgeIndianRupee, "Commission on the first payment and on every renewal"], [Wallet, "Monthly payouts to your bank account"], [BarChart3, "Your own dashboard: referrals, payments and earnings"]] as const).map(([Icon, l], i) => (
              <li key={l} className="hr-up flex items-center gap-3 text-[15px] text-white/90" style={{ ["--d" as string]: 4 + i }}>
                <span className="size-9 rounded-lg bg-white/10 border border-white/15 flex items-center justify-center flex-none"><Icon size={18} aria-hidden className="hr-breathe text-[#5EEAD4]" /></span>{l}
              </li>
            ))}
          </ul>
        </aside>
        <div className="relative overflow-hidden flex items-center justify-center px-4 py-[clamp(24px,5vh,56px)]">
        <div aria-hidden className="pointer-events-none absolute inset-0"><div className="site-blob site-blob-b bg-[#14B8A6]/10" /><div className="site-blob site-blob-c bg-[#F5C451]/12" /></div>
        <SideIcons />
        <div className="hr-form relative w-[min(460px,100%)] flex flex-col gap-4">
          <form onSubmit={(e) => { e.preventDefault(); primary(); }} className="hr-glow relative bg-white/90 backdrop-blur-md border border-white rounded-2xl p-7 flex flex-col gap-3.5 shadow-[0_24px_60px_-28px_rgba(11,94,91,.45)] max-[400px]:p-5">
            <div className="flex gap-3 items-center">
              <span className="hr-breathe size-11 rounded-xl bg-[#0B5E5B] text-[#5EEAD4] flex items-center justify-center flex-none shadow-[0_10px_20px_-10px_rgba(11,94,91,.8)]">{step === "enroll" || step === "totp" || step === "invite" || step === "inviteDone" || mode === "team" ? <BadgeCheck size={21} /> : <Handshake size={21} />}</span>
              <div className="flex flex-col leading-[1.3]"><h1 className="m-0 text-[20px] font-semibold">{step === "enroll" || step === "totp" ? "Staff console access" : step === "invite" || step === "inviteDone" ? "Medoro team invite" : mode === "team" ? "Set up Medoro admin" : "Reference partner sign in"}</h1><span className="text-[13px] text-muted">{step === "enroll" || step === "totp" ? "Super admins and customer care" : mode === "team" || step === "invite" || step === "inviteDone" ? "Medoro team" : "MRs, distributors and consultants"}</span></div>
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
                {gBtn("Continue with Google")}
                {google ? <div className="flex items-center gap-2.5 text-[12px] text-faint"><span className="h-px flex-1 bg-line" />or with email<span className="h-px flex-1 bg-line" /></div> : null}
                <label className={label}>Email<input className={input} value={email} onChange={(e) => { setEmail(e.target.value.trim()); setErr(""); }} placeholder="you@gmail.com" autoComplete="username" inputMode="email" /></label>
                <label className={label}>Password<input className={input} type="password" value={pwd} onChange={(e) => { setPwd(e.target.value); setErr(""); }} autoComplete="current-password" /></label>
                <div className="flex justify-end -mt-1.5 text-[13px]"><button type="button" onClick={() => setErr("Ask a Medoro admin to reset your partner password. Medoro team: use “Forgot password?” on the HRMS sign-in.")} className="min-h-10 inline-flex items-center text-teal cursor-pointer">Forgot password?</button></div>
              </>
            ) : null}

            {step === "signup" && mode === "team" ? (
              <>
                <span className="text-[14px] font-semibold">Set up the Medoro admin profile</span>
                <span className="text-[13px] text-muted">Only for the first super admin, with the email set as the admin email on the server. Everyone else on the team gets an invite from the admin.</span>
                {([["name", "Full name", "text", "name"], ["email", "Admin email", "email", "email"], ["phone", "Mobile", "tel", "tel"], ["password", "Create a password (12+ characters)", "password", "new-password"]] as const).map(([k, l, t, ac]) => (
                  <label key={k} className={label}>{l}<input className={input} type={t} autoComplete={ac} value={su[k]} onChange={(e) => { setSu((x) => ({ ...x, [k]: e.target.value })); setErr(""); }} /></label>
                ))}
              </>
            ) : null}

            {step === "signup" && mode === "partner" ? (
              <>
                <span className="text-[14px] font-semibold">Become a reference partner</span>
                <span className="text-[13px] text-muted">For MRs, distributors and consultants. Refer pharmacies to Medoro and earn commission on every plan they buy. Your account is ready straight away.</span>
                {google ? <>{gBtn("Continue with Google")}<div className="flex items-center gap-2.5 text-[12px] text-faint"><span className="h-px flex-1 bg-line" />or fill in your details<span className="h-px flex-1 bg-line" /></div></> : null}
                {([["name", "Full name", "text", "name"], ["email", "Email", "email", "email"], ["phone", "Mobile", "tel", "tel"], ["team", "Company / area (e.g. MR at Cipla, Pune)", "text", "off"], ["password", "Create a password (12+ characters)", "password", "new-password"]] as const).map(([k, l, t, ac]) => (
                  k === "email" && needCode ? (
                    <div key={k} className="flex flex-col gap-2">
                      <label className={label}>Email
                        <div className="flex gap-2">
                          <input className={input + (codeSent ? " bg-[#F7F8F9] text-muted" : "")} type="email" autoComplete="email" value={su.email} readOnly={codeSent} onChange={(e) => { setSu((x) => ({ ...x, email: e.target.value })); setErr(""); }} placeholder="you@gmail.com" />
                          <button type="button" disabled={busy || !su.email.includes("@")} onClick={() => (codeSent ? (setCodeSent(false), setEcode("")) : sendCode())} className="flex-none border border-input rounded-lg px-3 text-[13px] font-semibold text-teal cursor-pointer whitespace-nowrap disabled:opacity-50">{codeSent ? "Change" : "Send code"}</button>
                        </div>
                      </label>
                      {codeSent ? (
                        <label className={label}>6-digit code sent to your email
                          <input className={input + " font-mono text-[18px] tracking-[.3em]"} value={ecode} onChange={(e) => { setEcode(e.target.value.replace(/\D/g, "").slice(0, 6)); setErr(""); }} inputMode="numeric" autoComplete="one-time-code" />
                        </label>
                      ) : null}
                    </div>
                  ) : (
                    <label key={k} className={label}>{l}<input className={input} type={t} autoComplete={ac} value={su[k]} onChange={(e) => { setSu((x) => ({ ...x, [k]: e.target.value })); setErr(""); }} placeholder={k === "email" ? "you@gmail.com" : ""} /></label>
                  )
                ))}
              </>
            ) : null}

            {step === "signupDone" || step === "inviteDone" ? (
              <div className="flex flex-col items-center text-center gap-2 py-1.5">
                <span className="size-12 rounded-full bg-[#E7F6EE] text-[#18794E] flex items-center justify-center"><Check size={24} /></span>
                <strong className="text-[17px]">{step === "signupDone" ? "Account created" : "Password set"}</strong>
                <span className="text-[14px] text-muted">{step === "signupDone" ? doneText : "Sign in on the Medoro HRMS with your email and this password."}</span>
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
              <button type="submit" disabled={busy} className="hr-btn relative overflow-hidden bg-teal text-white rounded-[10px] p-3 text-[15px] font-semibold cursor-pointer flex gap-2 items-center justify-center transition-[background-color,transform,box-shadow] duration-300 hover:bg-[#094A48] hover:-translate-y-0.5 hover:shadow-[0_12px_24px_-12px_rgba(11,94,91,.7)] disabled:opacity-60">{busy ? "Please wait…" : label1}</button>
            ) : null}
            {step === "signin" && !handoff ? <button type="button" onClick={() => { setMode("partner"); setSu((x) => ({ ...x, role: "partner" })); setStep("signup"); setErr(""); }} className="self-center min-h-10 inline-flex items-center gap-1.5 text-[14px] font-semibold text-teal cursor-pointer"><UserPlus size={15} />New partner? Join free</button> : null}
            {step === "signin" && !handoff && setupOpen ? <button type="button" onClick={() => { setMode("team"); setSu((x) => ({ ...x, role: "sales" })); setStep("signup"); setErr(""); }} className="self-center min-h-10 inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-teal cursor-pointer"><UserPlus size={15} />Set up the admin profile</button> : null}
            {step === "signup" ? <button type="button" onClick={() => { setStep("signin"); setMode("partner"); setErr(""); }} className="self-center min-h-10 inline-flex items-center text-[13px] text-teal cursor-pointer">Back to sign in</button> : null}
            <div className="text-[11.5px] text-faint text-center">{step === "enroll" || step === "totp" ? "The staff console needs your authenticator app" : "Partners see only their own referrals and earnings"} · every sign-in is audited</div>
          </form>

          <div className="flex gap-2.5 items-start bg-white/90 backdrop-blur border border-[#E6E8EB] rounded-xl px-4 py-3.5 text-[13px] text-ink-2">
            <Lock size={16} className="text-teal mt-0.5 flex-none" />
            <span>Partners see only their own referrals and earnings. <strong className="font-semibold">No partner or Medoro staff account can open any pharmacy’s database, invoices or backups.</strong> Access to a customer environment needs that pharmacy owner’s time-limited approval.</span>
          </div>
          <div className="flex justify-center gap-4 flex-wrap text-[13px]">
            <Link href="/partners" className="whitespace-nowrap">About the reference partner programme</Link>
            <Link href="/signin" className="whitespace-nowrap">Pharmacy owner sign in</Link>
            <Link href="/signin?view=employee" className="whitespace-nowrap">Pharmacy staff sign in</Link>
          </div>
        </div>
        </div>
      </main>
    </div>
  );
}

export function GoogleG() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true" className="flex-none">
      <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z" />
    </svg>
  );
}
