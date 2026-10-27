import "server-only";
import { createHash, randomInt } from "node:crypto";
import { db } from "./db";

// SMS OTP goes through the provider in OTP_PROVIDER. Blank disables mobile OTP.
// "console" prints the code to the server log; use it only for local development.
export const otpEnabled = () => !!process.env.OTP_PROVIDER;

const hashCode = (phone: string, code: string) =>
  createHash("sha256").update(phone + ":" + code + ":" + (process.env.SESSION_SECRET ?? "")).digest("hex");

export async function sendOtp(phone: string, purpose: "signin" | "invite"): Promise<void> {
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const data = { codeHash: hashCode(phone, code), purpose, attempts: 0, expiresAt: new Date(Date.now() + 5 * 60_000) };
  await db.otpCode.upsert({ where: { phone }, create: { phone, ...data }, update: data });
  if (process.env.OTP_PROVIDER === "console") console.info(`[otp] ${purpose} code for ${phone}: ${code}`);
  else throw new Error(`OTP provider “${process.env.OTP_PROVIDER}” is not connected yet.`);
}

/** Single use, 5-minute expiry, 5 attempts. */
export async function verifyOtp(phone: string, code: string, purpose: "signin" | "invite"): Promise<{ ok: true } | { ok: false; left: number }> {
  const r = await db.otpCode.findUnique({ where: { phone } });
  if (!r || r.purpose !== purpose || r.expiresAt < new Date() || r.attempts >= 5) return { ok: false, left: 0 };
  if (r.codeHash === hashCode(phone, code)) { await db.otpCode.delete({ where: { phone } }); return { ok: true }; }
  await db.otpCode.update({ where: { phone }, data: { attempts: { increment: 1 } } });
  return { ok: false, left: 4 - r.attempts };
}
