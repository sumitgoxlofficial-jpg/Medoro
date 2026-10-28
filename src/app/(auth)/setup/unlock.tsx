"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AuthButton, AuthCard, AuthError, AuthLabel, authInput } from "@/components/auth-ui";
import { unlockSetupAction } from "../actions";

/** Asks for SETUP_TOKEN before the setup wizard opens on a public server. */
export function Unlock({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const [token, setToken] = useState("");
  const [err, setErr] = useState("");
  const [busy, start] = useTransition();
  return (
    <div className="min-h-dvh grid place-items-center bg-page p-4">
      <AuthCard>
        <h1 className="m-0 text-[20px] font-bold">Set up Medoro</h1>
        {disabled ? (
          <p className="m-0 text-[14px] text-ink-2">Setup is locked on this server. Add a <code>SETUP_TOKEN</code> environment variable in the hosting settings, redeploy, then open this page again.</p>
        ) : (
          <form className="flex flex-col gap-3.5" onSubmit={(e) => { e.preventDefault(); start(async () => { const r = await unlockSetupAction(token); if (r.ok) router.refresh(); else setErr(r.error); }); }}>
            <p className="m-0 text-[14px] text-ink-2">This server is public, so setup is protected. Enter the setup token from the hosting settings (<code>SETUP_TOKEN</code>).</p>
            <AuthLabel label="Setup token"><input className={authInput} type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} /></AuthLabel>
            <AuthError>{err}</AuthError>
            <AuthButton type="submit" disabled={busy || !token}>Continue</AuthButton>
          </form>
        )}
      </AuthCard>
    </div>
  );
}
