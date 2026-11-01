import "server-only";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { mailEnabled, sendMail } from "@/server/mail";
import { hashCode, newCode, throttleSend, verifyOtp } from "@/server/otp";
import { setVerifiedEmail } from "@/server/google-oidc";

// Sign-up with email: a 6-digit code proves the address before the pharmacy form opens, as Google does.
const MIN = 10;
const key = (email: string) => "email:" + email;
export const normEmail = (e: string) => String(e ?? "").trim().toLowerCase();
const looksLikeEmail = (e: string) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) && e.length <= 200;

export async function sendSignupCode(raw: string) {
  const email = normEmail(raw);
  if (!looksLikeEmail(email)) throw new UserError("Enter a valid email.");
  if (!mailEnabled()) throw new UserError("Email isn’t set up on this server. Use “Continue with Google”.");
  if (await db.user.findFirst({ where: { email }, select: { id: true } })) throw new UserError("An account with this email already exists. Sign in instead.");
  await throttleSend(key(email));
  const code = newCode();
  const data = { codeHash: hashCode(key(email), code), purpose: "signup", attempts: 0, expiresAt: new Date(Date.now() + MIN * 60_000) };
  await db.otpCode.upsert({ where: { phone: key(email) }, create: { phone: key(email), ...data }, update: data });
  try {
    await sendMail({
      to: email,
      subject: `Your Medoro sign-up code: ${code}`,
      text: `Hi,\n\nUse this code to create your Medoro pharmacy account:\n\n    ${code}\n\nIt expires in ${MIN} minutes. If you didn't ask for it, you can ignore this email.\n\nMedoro`,
    });
  } catch (e) {
    await db.otpCode.deleteMany({ where: { phone: key(email) } });
    throw e;
  }
}

export async function verifySignupCode(raw: string, code: string) {
  const email = normEmail(raw);
  const r = await verifyOtp(key(email), String(code ?? "").replace(/\D/g, ""), "signup");
  if (!r.ok) throw new UserError(r.left ? `That code didn’t match. ${r.left} attempt${r.left > 1 ? "s" : ""} left.` : "That code has expired. Send a new one.");
  await setVerifiedEmail(email);
}
