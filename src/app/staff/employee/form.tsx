"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { hrSendCode, hrSignIn } from "../hrms/actions";
import { HR_CARDS, IdBadge, SideIcons, TeamOrbit } from "./art";

const field = "border border-[#CDD2D7] rounded-[10px] px-3.5 py-3 text-[15px] outline-none transition-[border-color,box-shadow] duration-300 focus:border-[#0B5E5B] focus:shadow-[0_0_0_4px_rgba(20,184,166,.18)] bg-white w-full";

export function EmployeeLogin({ emailCodes }: { emailCodes: boolean }) {
  const router = useRouter();
  const [id, setId] = useState(""), [pw, setPw] = useState(""), [code, setCode] = useState("");
  const [totp, setTotp] = useState(false), [err, setErr] = useState(""), [info, setInfo] = useState("");
  const [busy, start] = useTransition();
  const submit = (e: React.FormEvent) => {
    e.preventDefault(); setErr(""); setInfo("");
    start(async () => {
      const r = await hrSignIn(id, pw, code);
      if (!r.ok) return setErr(r.error);
      if (r.data.next === "totp") { setTotp(true); return; }
      router.replace("/staff/hrms");
      router.refresh();
    });
  };
  const forgot = () => {
    setErr(""); setInfo("");
    if (!emailCodes) return setInfo("Ask HR for a one-time password: HR → Credentials. It works once, then you set a new password.");
    start(async () => {
      const r = await hrSendCode(id);
      if (!r.ok) return setErr(r.error);
      setInfo("If that ID exists, a 6-digit one-time password was emailed to you. Type it as the password above.");
    });
  };
  return (
    <div className="hr-motion min-h-screen flex max-[860px]:flex-col" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
      <div className="relative overflow-hidden flex-[1.05] bg-[#0B5E5B] text-white px-12 py-11 flex flex-col max-[860px]:flex-none max-[860px]:px-6 max-[860px]:py-6">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="hr-dots absolute inset-0" />
          <div className="site-blob site-blob-a bg-[#14B8A6]/30" />
          <div className="site-blob site-blob-b bg-[#F5C451]/15" />
          <div className="site-blob site-blob-c bg-[#4ADE80]/15" />
        </div>
        <div className="relative flex items-center gap-3 hr-up">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/medoro-mark.png" alt="" className="hr-breathe size-11 rounded-[10px] bg-white p-[3px]" />
          <div><div className="text-[26px] font-bold tracking-tight leading-none">Medoro</div><div className="text-[10.5px] tracking-[.1em] uppercase text-white/50 mt-1.5">HRMS · Pharmacy software</div></div>
        </div>
        <div className="relative my-auto grid grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] items-center gap-6 max-[1439px]:grid-cols-1 max-[1439px]:gap-2 max-[860px]:hidden">
          <div className="max-w-[420px]">
            <div className="hr-up text-[11px] font-bold text-[#14B8A6] uppercase tracking-[.08em] [--d:1]">Medoro team workspace</div>
            <h1 className="hr-up text-[34px] leading-[1.15] font-bold mt-2 [--d:2]"><span className="hr-shine">Built for how Indian pharmacies work.</span></h1>
            <p className="hr-up text-white/65 mt-3 text-[15px] [--d:3]">Attendance, leave, payslips, tasks and leads for everyone at Medoro, in one place.</p>
          </div>
          <div aria-hidden className="relative hr-up [--d:3] max-w-[460px] max-[1439px]:max-w-[340px] max-[1439px]:justify-self-start max-[1439px]:ml-6 w-full justify-self-center">
            <TeamOrbit className="w-full h-auto" />
            {HR_CARDS.map(([icon, text, bg, pos], i) => (
              <div key={text} style={{ ["--d" as string]: i }} className={`hr-card absolute ${pos} flex items-center gap-2 rounded-xl bg-white text-[#0f172a] shadow-[0_14px_30px_-12px_rgba(0,0,0,.45)] px-3 py-2 text-[12.5px] font-semibold whitespace-nowrap`}>
                <span className="size-7 rounded-lg flex items-center justify-center text-[14px]" style={{ background: bg }}>{icon}</span>{text}
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="relative overflow-hidden flex-1 bg-[#F8FAFC] flex items-center justify-center px-6 py-10">
        <div aria-hidden className="pointer-events-none absolute inset-0">
          <div className="site-blob site-blob-b bg-[#14B8A6]/10" />
          <div className="site-blob site-blob-c bg-[#F5C451]/12" />
        </div>
        <SideIcons />
        <div className="hr-form relative w-full max-w-[440px]">
        <IdBadge className="hr-badge absolute left-1/2 -translate-x-1/2 -top-[92px] w-[72px] h-auto max-[640px]:hidden" />
        <form onSubmit={submit} className="hr-glow relative w-full flex flex-col gap-4 rounded-2xl bg-white/80 backdrop-blur-md border border-white px-8 pt-10 pb-7 shadow-[0_24px_60px_-28px_rgba(11,94,91,.45)] max-[640px]:px-5 max-[640px]:pt-6 max-[640px]:bg-transparent max-[640px]:shadow-none max-[640px]:border-0 max-[640px]:backdrop-blur-none">
          <div><h2 className="text-[24px] font-bold text-[#0f172a]">Welcome to Medoro HRMS <span aria-hidden className="hr-wave inline-block">👋</span></h2><p className="text-[14px] text-[#475569] mt-1">Sign in with your employee ID or official email.</p></div>
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-[#0f172a]">Employee ID or official email
            <input className={field} value={id} onChange={(e) => setId(e.target.value)} placeholder="MS-004 or name@medoro.in" autoComplete="username" autoFocus required disabled={totp} />
          </label>
          <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-[#0f172a]">Password
            <input className={field} type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="current-password" required disabled={totp} />
          </label>
          {totp ? (
            <label className="flex flex-col gap-1.5 text-[13px] font-semibold text-[#0f172a]">Authenticator code
              <input className={field} inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} placeholder="6-digit code" autoComplete="one-time-code" autoFocus required />
            </label>
          ) : null}
          {err ? <div role="alert" className="text-[13.5px] text-[#B3261E] bg-[#FDECEA] rounded-lg px-3 py-2">{err}</div> : null}
          {info ? <div className="text-[13.5px] text-[#0B5E5B] bg-[#E1F1EF] rounded-lg px-3 py-2">{info}</div> : null}
          <button disabled={busy} className="hr-btn relative overflow-hidden bg-[#0B5E5B] text-white rounded-[10px] py-3 font-semibold text-[15px] cursor-pointer transition-[background-color,transform,box-shadow] duration-300 hover:bg-[#094A48] hover:-translate-y-0.5 hover:shadow-[0_12px_24px_-12px_rgba(11,94,91,.7)] disabled:opacity-60">{busy ? "Signing in…" : "Sign in"}</button>
          <div className="flex justify-between text-[13px]">
            <button type="button" onClick={forgot} disabled={busy || !id.trim()} className="text-[#0B5E5B] font-semibold cursor-pointer disabled:opacity-50 bg-transparent border-0 p-0">Forgot password?</button>
            <Link href="/" className="text-[#475569]">← medoro website</Link>
          </div>
          <p className="text-[12px] text-[#64748B] border-t border-[#E2E8F0] pt-3">Only Medoro employees can sign in. Your employee ID and first password come from HR. Locks for 15 minutes after 5 wrong tries.</p>
        </form>
        </div>
      </div>
    </div>
  );
}
