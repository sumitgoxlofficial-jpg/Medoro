"use client";
import { useState } from "react";
import { mfaConfirm, mfaStart } from "../actions";
import { Field, btnCls, inputCls, primaryCls, useRun } from "./kit";

/** Scan a QR code, type the code: two-step sign-in is on. Used by the first-sign-in step and by My profile. */
export function MfaSetup({ onDone }: { onDone?: () => void }) {
  const { run, busy } = useRun();
  const [qr, setQr] = useState<{ qr: string; secret: string } | null>(null);
  const [code, setCode] = useState("");
  if (!qr) return <div className="flex flex-col gap-3"><p className="text-[13px] text-[#475569]">You will need your phone. From then on, signing in asks for your password and a 6-digit code from the app.</p><div><button className={primaryCls} disabled={busy} onClick={() => run(() => mfaStart(), (d) => { setQr(d); })}>Show my QR code</button></div></div>;
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); run(() => mfaConfirm(code), () => { onDone?.(); return "Two-step sign-in is on."; }); }}>
      <div className="flex gap-4 items-start flex-wrap">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={qr.qr} alt="QR code for your authenticator app" width={196} height={196} className="border border-[#E2E8F0] rounded-lg" />
        <div className="flex flex-col gap-2 text-[12.5px] text-[#475569] max-w-[320px]">
          <span>Can’t scan? Enter this key in the app instead:</span>
          <code className="text-[13px] font-semibold tracking-[.08em] break-all bg-[#F8FAFC] border border-[#E2E8F0] rounded px-2 py-1">{qr.secret}</code>
          <button type="button" className={btnCls} disabled={busy} onClick={() => run(() => mfaStart(), (d) => { setQr(d); setCode(""); })}>New QR code</button>
        </div>
      </div>
      <Field label="Code from the app"><input className={inputCls + " !w-40 tracking-[.2em]"} inputMode="numeric" autoComplete="one-time-code" maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} required /></Field>
      <div><button className={primaryCls} disabled={busy || code.length !== 6}>Turn on two-step sign-in</button></div>
    </form>
  );
}
