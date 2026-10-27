import { redirect } from "next/navigation";
import { readSession } from "@/server/auth";
import { openSecret, totpQr } from "@/server/totp";
import { ensureMfaSecret } from "../../actions";
import { MfaForm } from "./mfa-form";

export const metadata = { title: "Two-step verification" };
export const dynamic = "force-dynamic";

export default async function Page() {
  let s = await readSession(true);
  if (!s) redirect("/signin");
  if (s.mfaPassed) redirect("/app");
  if (!s.user.mfaEnabled && !s.user.mfaSecret) { await ensureMfaSecret(); s = await readSession(true); }
  const u = s!.user;
  let enrol: { qr: string; secret: string } | null = null;
  if (!u.mfaEnabled && u.mfaSecret) {
    const b32 = openSecret(u.mfaSecret);
    enrol = { qr: await totpQr(b32, u.email ?? u.phone ?? u.name), secret: b32.match(/.{1,4}/g)!.join(" ") };
  }
  return <MfaForm enrol={enrol} name={u.name} />;
}
