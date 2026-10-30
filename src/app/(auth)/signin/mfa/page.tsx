import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { readSession } from "@/server/auth";
import { openSecret, totpQr } from "@/server/totp";
import { mfaResetOption } from "@/domain/identity/recovery";
import { ensureMfaSecret } from "../../actions";
import { MfaForm } from "./mfa-form";

export const metadata = { title: "Two-step verification" };
export const dynamic = "force-dynamic";

export default async function Page() {
  let s = await readSession(true);
  if (!s) redirect("/signin");
  // A verify action sets cookies, so Next re-renders this page in the same request. Redirecting then would
  // skip the one-time recovery codes on screen; only plain visits are sent on to the app.
  if (s.mfaPassed && !(await headers()).get("next-action")) redirect("/app");
  if (!s.user.mfaEnabled && !s.user.mfaSecret) { await ensureMfaSecret(); s = await readSession(true); }
  const u = s!.user;
  let enrol: { qr: string; secret: string } | null = null;
  if (!u.mfaEnabled && u.mfaSecret) {
    const b32 = openSecret(u.mfaSecret);
    enrol = { qr: await totpQr(b32, u.email ?? u.phone ?? u.name), secret: b32.match(/.{1,4}/g)!.join(" ") };
  }
  return <MfaForm enrol={enrol} name={u.name} reset={u.mfaEnabled ? await mfaResetOption(s!) : null} />;
}
