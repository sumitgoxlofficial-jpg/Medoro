"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { hrSendCode, hrSignIn } from "../hrms/actions";

const field = "border border-[#CDD2D7] rounded-[10px] px-3.5 py-3 text-[15px] outline-none focus:border-[#0B5E5B] bg-white w-full";

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
    <div className="min-h-screen flex max-[860px]:flex-col" style={{ fontFamily: "Inter, system-ui, sans-serif" }}>
      <div className="flex-[1.05] bg-[#0B5E5B] text-white px-12 py-11 flex flex-col max-[860px]:flex-none max-[860px]:px-6 max-[860px]:py-6">
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/medoro-mark.png" alt="" className="size-11 rounded-[10px] bg-white p-[3px]" />
          <div><div className="text-[26px] font-bold tracking-tight leading-none">Medoro</div><div className="text-[10.5px] tracking-[.1em] uppercase text-white/50 mt-1.5">HRMS · Pharmacy software</div></div>
        </div>
        <div className="my-auto max-w-[420px] max-[860px]:hidden">
          <div className="text-[11px] font-bold text-[#14B8A6] uppercase tracking-[.08em]">Medoro team workspace</div>
          <h1 className="text-[34px] leading-[1.15] font-bold mt-2 text-[#D6F3EF]">Built for how Indian pharmacies work.</h1>
          <p className="text-white/65 mt-3 text-[15px]">Attendance, leave, payslips, tasks and leads for everyone at Medoro, in one place.</p>
        </div>
      </div>
      <div className="flex-1 bg-[#F8FAFC] flex items-center justify-center px-6 py-10">
        <form onSubmit={submit} className="w-full max-w-[380px] flex flex-col gap-4">
          <div><h2 className="text-[24px] font-bold text-[#0f172a]">Welcome to Medoro HRMS</h2><p className="text-[14px] text-[#475569] mt-1">Sign in with your employee ID or official email.</p></div>
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
          <button disabled={busy} className="bg-[#0B5E5B] text-white rounded-[10px] py-3 font-semibold text-[15px] cursor-pointer hover:bg-[#094A48] disabled:opacity-60">{busy ? "Signing in…" : "Sign in"}</button>
          <div className="flex justify-between text-[13px]">
            <button type="button" onClick={forgot} disabled={busy || !id.trim()} className="text-[#0B5E5B] font-semibold cursor-pointer disabled:opacity-50 bg-transparent border-0 p-0">Forgot password?</button>
            <Link href="/" className="text-[#475569]">← medoro website</Link>
          </div>
          <p className="text-[12px] text-[#64748B] border-t border-[#E2E8F0] pt-3">Only Medoro employees can sign in. Your employee ID and first password come from HR. Locks for 15 minutes after 5 wrong tries.</p>
        </form>
      </div>
    </div>
  );
}
