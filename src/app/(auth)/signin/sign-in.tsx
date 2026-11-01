"use client";
import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { IdCard, UserPlus, Check, KeyRound } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { WA } from "@/components/site/brand";
import { AuthButton, AuthCard, AuthError, AuthLabel, Steps, authInput, authMono } from "@/components/auth-ui";
import {
  checkInviteContact, completeInvite, countersFor, employeeSignIn, findInvite, forgotPassword, passwordSignIn, resetPassword,
} from "../actions";

type View = "signin" | "employee" | "join" | "forgot";
type Recovery = { email: boolean; sms: boolean };

const GOOGLE_NOTICE: Record<string, string> = {
  nouser: "No Medoro account uses that Google email. Sign in with your password and connect Google from Profile, or start a free trial.",
  taken: "That Google account is already connected to another Medoro user.",
  inactive: "This account is deactivated. Ask the pharmacy owner.",
  locked: "Too many sign-in attempts on this account. Try again in 15 minutes.",
  state: "Google sign-in timed out or was opened in another browser. Try again.",
  error: "Google sign-in didn’t complete. Try again.",
  cancelled: "Google sign-in was cancelled.",
  off: "Google sign-in isn’t set up on this server.",
};

export function SignIn({ google, recovery, notice, linkEmail, initialView }: { google: boolean; recovery: Recovery; notice: string | null; linkEmail: string | null; initialView: View }) {
  const [view, setView] = useState<View>(initialView);
  const [prefill, setPrefill] = useState<{ code: string; emp: string } | null>(null);
  if (view === "employee") return <Employee onOwner={() => setView("signin")} onJoin={() => setView("join")} prefill={prefill} />;
  if (view === "join") return <Join onDone={(code, emp) => { setPrefill({ code, emp }); setView("employee"); }} onBack={() => setView("employee")} />;
  if (view === "forgot") return <Forgot recovery={recovery} onBack={() => setView("signin")} />;
  return <Owner google={google} notice={notice} linkEmail={linkEmail} onEmployee={() => setView("employee")} onForgot={() => setView("forgot")} />;
}

function Owner({ google, notice, linkEmail, onEmployee, onForgot }: { google: boolean; notice: string | null; linkEmail: string | null; onEmployee: () => void; onForgot: () => void }) {
  const router = useRouter();
  const [email, setEmail] = useState(linkEmail ?? ""), [pwd, setPwd] = useState("");
  const [err, setErr] = useState(""), [pending, start] = useTransition();

  const submit = (e: React.FormEvent) => {
    e.preventDefault(); setErr("");
    start(async () => {
      const r = await passwordSignIn(email, pwd);
      if (!r.ok) return setErr(r.error);
      router.replace(r.data!);
    });
  };

  return (
    <AuthCard>
      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <div className="text-[22px] font-semibold">Sign in</div>
        {linkEmail ? <div role="status" className="text-[13px] bg-teal-soft border border-teal-line rounded-lg p-3">Google confirmed <strong>{linkEmail}</strong>. Enter your Medoro password once to connect Google sign-in to this account.</div>
          : notice && GOOGLE_NOTICE[notice] ? <div role="status" className="text-[13px] bg-chip rounded-lg p-3">{GOOGLE_NOTICE[notice]}</div> : null}
        <AuthLabel label="Email"><input className={authInput} type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@pharmacy.in" autoComplete="username" autoFocus={!linkEmail} /></AuthLabel>
        <AuthLabel label="Password"><input className={authInput} type="password" value={pwd} onChange={(e) => setPwd(e.target.value)} autoComplete="current-password" autoFocus={!!linkEmail} /></AuthLabel>
        <button type="button" onClick={onForgot} className="self-end -mt-1.5 min-h-10 inline-flex items-center text-[13px] text-teal cursor-pointer">Forgot password?</button>
        <AuthError>{err}</AuthError>
        <AuthButton type="submit" disabled={pending}>
          {pending ? "Please wait…" : "Sign in"}
        </AuthButton>
      </form>
      {google ? (
        <a href="/api/auth/google/start" className="flex items-center justify-center gap-2.5 border border-input bg-white rounded-[10px] py-[11px] text-[14px] font-semibold text-ink no-underline cursor-pointer hover:border-teal hover:text-ink">
          <GoogleG />Continue with Google
        </a>
      ) : null}
      <button onClick={onEmployee} className="flex items-center justify-center gap-2 border border-input bg-white rounded-[10px] py-[11px] text-[14px] font-semibold text-ink cursor-pointer hover:border-teal hover:text-teal">
        <IdCard size={16} />Pharmacy staff login (PIN)
      </button>
      <p className="m-0 text-[13px] text-muted text-center">New to Medoro? <a href="/trial" className="text-teal font-semibold">Start a free trial</a></p>
      <p className="m-0 text-[12px] text-fainter text-center">Trouble signing in? <a href={WA} target="_blank" rel="noreferrer" className="text-teal font-medium">WhatsApp Medoro support</a></p>
    </AuthCard>
  );
}

function Employee({ onOwner, onJoin, prefill }: { onOwner: () => void; onJoin: () => void; prefill: { code: string; emp: string } | null }) {
  const router = useRouter();
  const [code, setCode] = useState(prefill?.code ?? ""), [emp, setEmp] = useState(prefill?.emp ?? ""), [pin, setPin] = useState("");
  const [counters, setCounters] = useState<{ id: string; name: string; branch: string }[]>([]);
  const [counter, setCounter] = useState("");
  const [err, setErr] = useState(""), [pending, start] = useTransition();

  useEffect(() => {
    if (code.trim().length < 4) { setCounters([]); return; }
    const t = setTimeout(() => countersFor(code, emp).then((c) => { setCounters(c); setCounter((x) => (c.some((y) => y.id === x) ? x : c[0]?.id ?? "")); }), 350);
    return () => clearTimeout(t);
  }, [code, emp]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault(); setErr("");
    start(async () => {
      const r = await employeeSignIn({ code, employeeNo: emp, pin, counterId: counter });
      if (!r.ok) { setPin(""); return setErr(r.error); }
      router.replace(r.data!);
    });
  };

  return (
    <AuthCard width={440}>
      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <div className="flex gap-2.5 items-center">
          <span className="size-9 rounded-[9px] bg-teal-tint text-teal flex items-center justify-center flex-none"><IdCard size={18} /></span>
          <div className="flex flex-col leading-tight"><span className="text-[20px] font-semibold">Pharmacy staff login</span><span className="text-[13px] text-muted">For pharmacists, cashiers and accountants</span></div>
        </div>
        <AuthLabel label="Pharmacy code"><input className={cn(authInput, authMono)} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="SANJ-PUNE" autoFocus={!prefill} /></AuthLabel>
        <AuthLabel label="Employee ID"><input className={cn(authInput, authMono)} value={emp} onChange={(e) => setEmp(e.target.value.toUpperCase())} placeholder="E-104" /></AuthLabel>
        <AuthLabel label="4-digit PIN"><input className={cn(authInput, "font-mono tracking-[.3em]")} type="password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" placeholder="••••" autoFocus={!!prefill} autoComplete="off" /></AuthLabel>
        <div className="flex flex-col gap-1.5">
          <span className="text-[13px] text-muted">Counter</span>
          {counters.length ? (
            <div className="flex gap-2 flex-wrap">
              {counters.map((c) => {
                const a = c.id === counter;
                return (
                  <button type="button" key={c.id} onClick={() => setCounter(c.id)} className="flex flex-col items-start rounded-lg px-3 py-2 text-[13.5px] font-medium cursor-pointer"
                    style={{ border: a ? "1.5px solid #0B5E5B" : "1px solid #CDD2D7", background: a ? "#E1F1EF" : "#fff", color: a ? "#0B5E5B" : "#1F2328" }}>
                    {c.name}<span className="text-[11.5px] font-normal text-faint">{c.branch}</span>
                  </button>
                );
              })}
            </div>
          ) : <span className="text-[12.5px] text-fainter">Enter your pharmacy code to see counters.</span>}
        </div>
        <AuthError>{err}</AuthError>
        <AuthButton type="submit" disabled={pending}>{pending ? "Checking…" : "Start shift"}</AuthButton>
      </form>
      <button onClick={onJoin} className="flex items-center justify-center gap-2 border border-input bg-white rounded-[10px] py-[11px] text-[14px] font-semibold text-ink cursor-pointer hover:border-teal hover:text-teal">
        <UserPlus size={16} />New employee? Create your account
      </button>
      <div className="flex justify-between gap-2 flex-wrap text-[12.5px]">
        <button onClick={onOwner} className="text-teal cursor-pointer">← Owner / manager sign-in</button>
        <span className="text-faint">Forgot PIN? Ask your manager to reset it.</span>
      </div>
      <div className="text-[11.5px] text-fainter text-center">5 wrong PINs lock the ID for 15 minutes · shift start is logged</div>
    </AuthCard>
  );
}

function Join({ onDone, onBack }: { onDone: (code: string, emp: string) => void; onBack: () => void }) {
  const [step, setStep] = useState(1);
  const [code, setCode] = useState(""), [inv, setInv] = useState("");
  const [info, setInfo] = useState<{ role: string; branch: string; pharmacy: string; name: string | null; kind: "phone" | "email" } | null>(null);
  const [contact, setContact] = useState(""), [otp, setOtp] = useState(""), [otpSent, setOtpSent] = useState(false);
  const [name, setName] = useState(""), [pin, setPin] = useState(""), [pin2, setPin2] = useState(""), [agree, setAgree] = useState(false);
  const [done, setDone] = useState<{ employeeNo: string; tenantCode: string; manager: boolean } | null>(null);
  const [err, setErr] = useState(""), [pending, start] = useTransition();
  const manager = info?.role === "Manager";

  const next = () => {
    setErr("");
    start(async () => {
      if (step === 1) {
        if (code.trim().length < 4) return setErr("Enter the pharmacy code from your invite.");
        const r = await findInvite(code, inv);
        if (!r.ok) return setErr(r.error);
        setInfo(r.data!); setName(r.data!.name ?? ""); setStep(2);
      } else if (step === 2) {
        if (!otpSent) {
          const r = await checkInviteContact(code, inv, contact);
          if (!r.ok) return setErr(r.error);
          if (r.data!.otpSent) setOtpSent(true); else setStep(3);
        } else {
          if (otp.length !== 6) return setErr("Enter the 6-digit OTP.");
          setStep(3);
        }
      } else if (step === 3) {
        if (pin !== pin2) return setErr(manager ? "Passwords do not match." : "PINs do not match.");
        const r = await completeInvite({ code, inviteCode: inv, contact, otp, name, agree, ...(manager ? { password: pin } : { pin }) });
        if (!r.ok) { if (/OTP|code has expired/.test(r.error)) { setStep(2); setOtp(""); } return setErr(r.error); }
        setDone(r.data!); setStep(4);
      }
    });
  };

  return (
    <AuthCard width={440}>
      <div className="flex gap-2.5 items-center">
        <span className="size-9 rounded-[9px] bg-teal-tint text-teal flex items-center justify-center flex-none"><UserPlus size={18} /></span>
        <div className="flex flex-col leading-tight"><span className="text-[20px] font-semibold">Create employee account</span><span className="text-[13px] text-muted">Use the invite code your owner or manager sent you</span></div>
      </div>
      <Steps labels={["Invite", "Verify", manager ? "Password" : "PIN"]} step={Math.min(step, 3)} />
      {step === 1 ? (
        <>
          <AuthLabel label="Pharmacy code"><input className={cn(authInput, authMono)} value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="SANJ-PUNE" autoFocus /></AuthLabel>
          <AuthLabel label="Invite code"><input className={cn(authInput, authMono)} value={inv} onChange={(e) => setInv(e.target.value.toUpperCase())} placeholder="XXXX-00" /></AuthLabel>
        </>
      ) : null}
      {step === 2 && info ? (
        <>
          <div className="text-[13px] bg-teal-soft border border-teal-line rounded-lg p-3">Invite found: <strong>{info.role}</strong> · {info.branch} · {info.pharmacy}</div>
          <AuthLabel label={info.kind === "phone" ? "Mobile number on the invite" : "Email on the invite"}>
            <input className={authInput} value={contact} onChange={(e) => setContact(e.target.value)} placeholder={info.kind === "phone" ? "98220 41736" : "you@example.com"} disabled={otpSent} autoFocus />
          </AuthLabel>
          {otpSent ? <AuthLabel label="6-digit OTP"><input className={cn(authInput, "font-mono text-[18px] tracking-[.3em]")} value={otp} onChange={(e) => setOtp(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoFocus /></AuthLabel> : null}
        </>
      ) : null}
      {step === 3 ? (
        <>
          <AuthLabel label="Your full name"><input className={authInput} value={name} onChange={(e) => setName(e.target.value)} autoFocus /></AuthLabel>
          {manager ? (
            <>
              <AuthLabel label="Create a password (10+ characters)"><input className={authInput} type="password" value={pin} onChange={(e) => setPin(e.target.value)} autoComplete="new-password" /></AuthLabel>
              <AuthLabel label="Confirm password"><input className={authInput} type="password" value={pin2} onChange={(e) => setPin2(e.target.value)} autoComplete="new-password" /></AuthLabel>
              <span className="text-[12px] text-faint">Managers sign in with email, password and an authenticator app. You’ll set up the authenticator on first sign-in.</span>
            </>
          ) : (
            <>
              <AuthLabel label="Create a 4-digit PIN"><input className={cn(authInput, "font-mono tracking-[.3em]")} type="password" value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" placeholder="••••" /></AuthLabel>
              <AuthLabel label="Confirm PIN"><input className={cn(authInput, "font-mono tracking-[.3em]")} type="password" value={pin2} onChange={(e) => setPin2(e.target.value.replace(/\D/g, "").slice(0, 4))} inputMode="numeric" placeholder="••••" /></AuthLabel>
              <span className="text-[12px] text-faint">Avoid easy PINs like 1111 or 1234. Never share your PIN, because every bill is recorded under your name.</span>
            </>
          )}
          <label className="flex gap-2 text-[13px] text-ink-2 cursor-pointer"><input type="checkbox" className="accent-teal mt-0.5" checked={agree} onChange={(e) => setAgree(e.target.checked)} />I agree to the staff terms and the pharmacy’s privacy notice.</label>
        </>
      ) : null}
      {step === 4 && done ? (
        <div className="flex flex-col items-center text-center gap-2 py-3">
          <span className="size-11 rounded-full bg-ok-bg text-ok flex items-center justify-center"><Check size={22} /></span>
          <strong className="text-[17px]">Account ready</strong>
          <span className="text-[13.5px] text-muted">
            {done.manager ? <>Sign in with your email and password from the owner / manager sign-in.</> : <>Your employee ID is <strong className="font-mono text-ink">{done.employeeNo}</strong>. Use it with pharmacy code <span className="font-mono">{done.tenantCode}</span> and your PIN.</>}
          </span>
        </div>
      ) : null}
      <AuthError>{err}</AuthError>
      <AuthButton onClick={step === 4 ? () => (done?.manager ? location.assign("/signin") : onDone(done!.tenantCode, done!.employeeNo)) : next} disabled={pending}>
        {pending ? "Please wait…" : step === 1 ? "Find my invite" : step === 2 ? (otpSent ? "Verify OTP" : "Continue") : step === 3 ? "Create account" : done?.manager ? "Go to sign-in" : "Go to employee login"}
      </AuthButton>
      {step < 4 ? (
        <div className="flex justify-between gap-2 flex-wrap text-[12.5px]">
          <button onClick={onBack} className="text-teal cursor-pointer">← Pharmacy staff login</button>
          <span className="text-faint">No code? Ask your manager to add you in Users.</span>
        </div>
      ) : null}
    </AuthCard>
  );
}

function Forgot({ recovery, onBack }: { recovery: Recovery; onBack: () => void }) {
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [contact, setContact] = useState(""), [code, setCode] = useState(""), [pw, setPw] = useState(""), [pw2, setPw2] = useState("");
  const [err, setErr] = useState(""), [pending, start] = useTransition();
  const label = recovery.email && recovery.sms ? "Email or mobile number" : recovery.email ? "Email" : "Mobile number";

  const submit = (e: React.FormEvent) => {
    e.preventDefault(); setErr("");
    start(async () => {
      if (step === 1) {
        const r = await forgotPassword(contact);
        if (!r.ok) return setErr(r.error);
        return setStep(2);
      }
      if (pw !== pw2) return setErr("Passwords do not match.");
      const r = await resetPassword({ contact, code, password: pw });
      if (!r.ok) return setErr(r.error);
      setStep(3);
    });
  };

  return (
    <AuthCard>
      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <div className="flex gap-2.5 items-center">
          <span className="size-9 rounded-[9px] bg-teal-tint text-teal flex items-center justify-center flex-none"><KeyRound size={18} /></span>
          <div className="flex flex-col leading-tight"><span className="text-[20px] font-semibold">Reset your password</span><span className="text-[13px] text-muted">For owners and managers</span></div>
        </div>
        {!recovery.email && !recovery.sms ? (
          <div className="text-[13px] text-muted bg-chip rounded-lg p-3">Password reset needs email or SMS, and neither is set up on this server. The person who runs the server can set MAIL_PROVIDER or OTP_PROVIDER (see docs/SECURITY.md). Managers can also ask the owner for a reset code from Users.</div>
        ) : step === 1 ? (
          <>
            <div className="text-[13.5px] text-muted">Enter the {label.toLowerCase()} on your account. We’ll send a 6-digit code that works once, for 15 minutes.</div>
            <AuthLabel label={label}><input className={authInput} value={contact} onChange={(e) => setContact(e.target.value)} placeholder={recovery.email ? "you@pharmacy.in" : "98220 41736"} autoComplete="username" autoFocus /></AuthLabel>
          </>
        ) : step === 2 ? (
          <>
            <div className="text-[13.5px] text-muted">If an account uses <strong className="text-ink">{contact.trim()}</strong>, a code is on its way. Codes expire in 15 minutes.</div>
            <AuthLabel label="6-digit code"><input className={cn(authInput, "font-mono text-[18px] tracking-[.3em]")} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" autoFocus /></AuthLabel>
            <AuthLabel label="New password (10+ characters)"><input className={authInput} type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" /></AuthLabel>
            <AuthLabel label="Confirm new password"><input className={authInput} type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" /></AuthLabel>
            <span className="text-[12px] text-faint">Resetting signs you out on every device. Two-step verification still applies when you sign in.</span>
          </>
        ) : (
          <div className="flex flex-col items-center text-center gap-2 py-3">
            <span className="size-11 rounded-full bg-ok-bg text-ok flex items-center justify-center"><Check size={22} /></span>
            <strong className="text-[17px]">Password changed</strong>
            <span className="text-[13.5px] text-muted">Sign in with your new password.</span>
          </div>
        )}
        <AuthError>{err}</AuthError>
        {step === 3 ? <AuthButton type="button" onClick={onBack}>Go to sign-in</AuthButton>
          : recovery.email || recovery.sms ? <AuthButton type="submit" disabled={pending || (step === 2 && code.length !== 6)}>{pending ? "Please wait…" : step === 1 ? "Send code" : "Set new password"}</AuthButton> : null}
      </form>
      {step !== 3 ? (
        <div className="flex justify-between gap-2 flex-wrap text-[12.5px]">
          <button onClick={onBack} className="text-teal cursor-pointer">← Back to sign-in</button>
          {step === 2 ? <button onClick={() => { setStep(1); setCode(""); setErr(""); }} className="text-teal cursor-pointer">Send a new code</button> : null}
        </div>
      ) : null}
    </AuthCard>
  );
}

function GoogleG() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.1H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.6-.4-3.9z" />
      <path fill="#FF3D00" d="m6.3 14.7 6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.1H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.6-.4-3.9z" />
    </svg>
  );
}