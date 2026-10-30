"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck, Copy, Download } from "lucide-react";
import { cn } from "@/components/ui/cn";
import { AuthButton, AuthCard, AuthError, authInput } from "@/components/auth-ui";
import type { ResetOption } from "@/domain/identity/recovery";
import { resetMfaWithCode, sendMfaResetCode, signOut, verifyMfa } from "../../actions";

type Mode = "totp" | "recovery" | "lost";
const codeInput = "w-full border border-input rounded-lg py-3 text-center font-mono text-[24px] tracking-[.4em] outline-none focus:border-teal focus:ring-2 focus:ring-teal/15";

export function MfaForm({ enrol, name, reset }: { enrol: { qr: string; secret: string } | null; name: string; reset: ResetOption | null }) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("totp");
  const [code, setCode] = useState(""), [trust, setTrust] = useState(true);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const [after, setAfter] = useState<{ next: string; codes?: string[]; remaining?: number } | null>(null);
  const [err, setErr] = useState(""), [pending, start] = useTransition();
  const switchTo = (m: Mode) => { setMode(m); setCode(""); setErr(""); setSentTo(null); };

  const submit = (e: React.FormEvent) => {
    e.preventDefault(); setErr("");
    start(async () => {
      if (mode === "lost") {
        if (!sentTo) {
          const r = await sendMfaResetCode();
          if (!r.ok) return setErr(r.error);
          return setSentTo(r.data!);
        }
        const r = await resetMfaWithCode(code);
        if (!r.ok) { setCode(""); return setErr(r.error); }
        switchTo("totp");
        return router.refresh();
      }
      const r = await verifyMfa(code, trust);
      if (!r.ok) { setCode(""); return setErr(r.error); }
      const d = r.data!;
      if (d.recoveryCodes || d.remaining !== undefined) return setAfter({ next: d.next, codes: d.recoveryCodes, remaining: d.remaining });
      router.replace(d.next);
    });
  };

  if (after) return <AfterMfa {...after} onDone={() => router.replace(after.next)} />;

  return (
    <AuthCard width={enrol ? 460 : 400}>
      <form onSubmit={submit} className="flex flex-col gap-3.5">
        <div className="flex items-center gap-2.5"><ShieldCheck size={22} className="text-teal" /><div className="text-[20px] font-semibold">{enrol ? "Set up two-step verification" : "Two-step verification"}</div></div>
        {enrol ? (
          <>
            <div className="text-[13.5px] text-muted">Hi {name.split(" ")[0]}. Owners and managers must use an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…). Scan this code, then enter the 6-digit code it shows.</div>
            <div className="flex gap-4 items-center flex-wrap">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={enrol.qr} alt="Authenticator QR code" width={156} height={156} className="border border-line rounded-lg" />
              <div className="flex flex-col gap-1 text-[12.5px] text-muted min-w-0 flex-1">
                Can’t scan? Enter this key:
                <code className="font-mono text-[13px] text-ink bg-chip rounded-md px-2 py-1.5 break-all">{enrol.secret}</code>
              </div>
            </div>
          </>
        ) : mode === "totp" ? (
          <div className="text-[13.5px] text-muted">Enter the 6-digit code from your authenticator app.</div>
        ) : mode === "recovery" ? (
          <div className="text-[13.5px] text-muted">Enter one of the recovery codes you saved when you set up two-step verification. Each code works once.</div>
        ) : (
          <div className="text-[13.5px] text-muted">
            {sentTo ? <>We sent a 6-digit code to <strong className="text-ink">{sentTo}</strong>. Enter it to remove your old authenticator and set up a new one. Your other devices will be signed out.</>
              : reset?.ok ? <>Lost your phone or authenticator? We can send a code to <strong className="text-ink">{reset.to}</strong> to reset two-step verification.</>
                : <>{reset?.reason ?? "Use a recovery code, or ask the owner to reset your two-step verification from Users."}</>}
          </div>
        )}
        {mode === "recovery" && !enrol ? (
          <input value={code} onChange={(e) => setCode(e.target.value.slice(0, 24))} autoComplete="one-time-code" autoFocus aria-label="Recovery code" placeholder="xxxx-xxxx-xxxx-xxxx"
            className={cn(authInput, "font-mono text-center text-[17px] tracking-[.08em]")} />
        ) : mode === "lost" && !enrol ? (
          sentTo ? <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" autoFocus aria-label="6-digit code" className={codeInput} /> : null
        ) : (
          <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" autoFocus aria-label="6-digit code" className={codeInput} />
        )}
        <AuthError>{err}</AuthError>
        {mode !== "lost" || enrol ? <label className="flex items-center gap-2 text-[13px] text-ink-2 cursor-pointer"><input type="checkbox" className="accent-teal" checked={trust} onChange={(e) => setTrust(e.target.checked)} />Trust this counter PC for 30 days</label> : null}
        {mode === "lost" && !enrol ? (
          <AuthButton type="submit" disabled={pending || !reset?.ok || (!!sentTo && code.length !== 6)}>{pending ? "Please wait…" : sentTo ? "Reset two-step verification" : "Send code"}</AuthButton>
        ) : (
          <AuthButton type="submit" disabled={pending || (mode === "recovery" && !enrol ? code.replace(/[^0-9a-z]/gi, "").length !== 16 : code.length !== 6)}>{pending ? "Checking…" : "Verify"}</AuthButton>
        )}
      </form>
      {!enrol ? (
        <div className="flex justify-center gap-4 flex-wrap text-[12.5px]">
          {mode !== "totp" ? <button onClick={() => switchTo("totp")} className="text-teal cursor-pointer">Use authenticator code</button> : null}
          {mode !== "recovery" ? <button onClick={() => switchTo("recovery")} className="text-teal cursor-pointer">Use a recovery code</button> : null}
          {mode !== "lost" ? <button onClick={() => switchTo("lost")} className="text-teal cursor-pointer">Lost your authenticator?</button> : null}
        </div>
      ) : null}
      <button onClick={() => start(() => signOut())} className="text-[12.5px] text-teal cursor-pointer self-center">Use a different account</button>
    </AuthCard>
  );
}

/** Shown once: new recovery codes after enrolment, or how many are left after using one. */
function AfterMfa({ codes, remaining, onDone }: { codes?: string[]; remaining?: number; onDone: () => void }) {
  const [saved, setSaved] = useState(!codes);
  const text = codes ? `Medoro recovery codes (each works once)\n\n${codes.join("\n")}\n` : "";
  return (
    <AuthCard width={460}>
      <div className="flex items-center gap-2.5"><ShieldCheck size={22} className="text-teal" /><div className="text-[20px] font-semibold">{codes ? "Save your recovery codes" : "Signed in with a recovery code"}</div></div>
      {codes ? (
        <>
          <div className="text-[13.5px] text-muted">If you lose your phone, each of these codes signs you in once instead of the authenticator. Store them somewhere safe and offline. They won’t be shown again.</div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1.5 bg-chip rounded-lg p-3 font-mono text-[14px] text-ink">{codes.map((c) => <span key={c}>{c}</span>)}</div>
          <div className="flex gap-2">
            <button type="button" onClick={() => { navigator.clipboard.writeText(text); setSaved(true); }} className="flex-1 flex items-center justify-center gap-2 border border-input bg-white rounded-[10px] py-2.5 text-[13.5px] font-semibold cursor-pointer hover:border-teal hover:text-teal"><Copy size={15} />Copy</button>
            <a href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`} download="medoro-recovery-codes.txt" onClick={() => setSaved(true)} className="flex-1 flex items-center justify-center gap-2 border border-input bg-white rounded-[10px] py-2.5 text-[13.5px] font-semibold text-ink no-underline hover:border-teal hover:text-teal"><Download size={15} />Download</a>
          </div>
          <label className="flex items-center gap-2 text-[13px] text-ink-2 cursor-pointer"><input type="checkbox" className="accent-teal" checked={saved} onChange={(e) => setSaved(e.target.checked)} />I’ve saved these codes</label>
        </>
      ) : (
        <div className="text-[13.5px] text-muted">
          You have <strong className="text-ink">{remaining}</strong> recovery code{remaining === 1 ? "" : "s"} left. {remaining! <= 3 ? "Generate new ones soon from Profile → Recovery codes, and set up your authenticator again if you lost it." : "Each code works once."}
        </div>
      )}
      <AuthButton onClick={onDone} disabled={!saved}>Continue</AuthButton>
    </AuthCard>
  );
}
