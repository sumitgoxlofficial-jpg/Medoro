"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { AuthButton, AuthCard, AuthError } from "@/components/auth-ui";
import { signOut, verifyMfa } from "../../actions";

export function MfaForm({ enrol, name }: { enrol: { qr: string; secret: string } | null; name: string }) {
  const router = useRouter();
  const [code, setCode] = useState(""), [trust, setTrust] = useState(true);
  const [err, setErr] = useState(""), [pending, start] = useTransition();
  const submit = (e: React.FormEvent) => {
    e.preventDefault(); setErr("");
    start(async () => {
      const r = await verifyMfa(code, trust);
      if (!r.ok) { setCode(""); return setErr(r.error); }
      router.replace(r.data!);
    });
  };
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
        ) : (
          <div className="text-[13.5px] text-muted">Enter the 6-digit code from your authenticator app.</div>
        )}
        <input value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" autoFocus aria-label="6-digit code"
          className="w-full border border-input rounded-lg py-3 text-center font-mono text-[24px] tracking-[.4em] outline-none focus:border-teal focus:ring-2 focus:ring-teal/15" />
        <AuthError>{err}</AuthError>
        <label className="flex items-center gap-2 text-[13px] text-ink-2 cursor-pointer"><input type="checkbox" className="accent-teal" checked={trust} onChange={(e) => setTrust(e.target.checked)} />Trust this counter PC for 30 days</label>
        <AuthButton type="submit" disabled={pending || code.length !== 6}>{pending ? "Checking…" : "Verify"}</AuthButton>
      </form>
      <button onClick={() => start(() => signOut())} className="text-[12.5px] text-teal cursor-pointer self-center">Use a different account</button>
    </AuthCard>
  );
}
