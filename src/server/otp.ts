import "server-only";
import { createHash, randomInt, timingSafeEqual } from "node:crypto";
import { MOBILE_RE, normPhone } from "@/domain/identity/contracts";
import { db } from "./db";
import { UserError } from "./action";
import { clientInfo, rateLimit } from "./auth";

// SMS codes go out through the gateway in OTP_PROVIDER: msg91, twilio, http (your own webhook) or
// console (prints codes to the server log; refused in production). Blank disables SMS.
export type OtpPurpose = "signin" | "invite" | "reset" | "mfa-reset";
type Env = Record<string, string | undefined>;

const PURPOSE: Record<OtpPurpose, string> = { signin: "sign-in", invite: "account setup", reset: "password reset", "mfa-reset": "two-step verification reset" };
const SEND_FAILED = "Couldn’t send the code, try again.";
const providerOf = (env: Env) => (env.OTP_PROVIDER ?? "").trim().toLowerCase();

export const otpEnabled = (env: Env = process.env) => {
  const p = providerOf(env);
  return !!p && !(p === "console" && env.NODE_ENV === "production");
};

/** +91XXXXXXXXXX for a 10-digit Indian mobile, with or without 0 / 91 / +91 in front. */
export function toE164(phone: string) {
  const p = normPhone(phone);
  if (!MOBILE_RE.test(p)) throw new UserError("Enter a valid 10-digit Indian mobile number.");
  return "+91" + p;
}

export const newCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");
export const hashCode = (scope: string, code: string) =>
  createHash("sha256").update(scope + ":" + code + ":" + (process.env.SESSION_SECRET ?? "")).digest("hex");
export const sameHash = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

function providerFailed(provider: string, detail: string): never {
  console.error(`[otp] ${provider} send failed: ${detail}`);
  throw new UserError(SEND_FAILED);
}

/** Sends a one-time code by SMS through the configured gateway. Throws a UserError the screen can show. */
export async function deliverSms(phone: string, code: string, purpose: OtpPurpose, minutes: number, env: Env = process.env) {
  const to = toE164(phone), p = providerOf(env);
  const text = `${code} is your Medoro ${PURPOSE[purpose]} code. It expires in ${minutes} minutes. Don't share it with anyone.`;
  const need = (...ks: string[]) => { const miss = ks.filter((k) => !env[k]); if (miss.length) providerFailed(p, `${miss.join(", ")} not set`); };
  let req: { url: string; init: RequestInit };
  switch (p) {
    case "console":
      if (env.NODE_ENV === "production") providerFailed(p, "the console provider is for local development only");
      console.info(`[otp] ${purpose} code for ${to}: ${code}`);
      return;
    case "msg91":
      // Flow API: the DLT-approved template must contain the ##otp## variable (##minutes## is optional).
      need("OTP_API_KEY", "OTP_TEMPLATE_ID");
      req = {
        url: "https://control.msg91.com/api/v5/flow",
        init: {
          method: "POST",
          headers: { authkey: env.OTP_API_KEY!, "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ template_id: env.OTP_TEMPLATE_ID, short_url: "0", ...(env.OTP_SENDER ? { sender: env.OTP_SENDER } : {}), recipients: [{ mobiles: to.slice(1), otp: code, minutes: String(minutes) }] }),
        },
      };
      break;
    case "twilio": {
      need("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM");
      const from = env.TWILIO_FROM!;
      req = {
        url: `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(env.TWILIO_ACCOUNT_SID!)}/Messages.json`,
        init: {
          method: "POST",
          headers: { Authorization: "Basic " + Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ To: to, Body: text, ...(from.startsWith("MG") ? { MessagingServiceSid: from } : { From: from }) }).toString(),
        },
      };
      break;
    }
    case "http":
      need("OTP_HTTP_URL");
      if (!env.OTP_HTTP_URL!.startsWith("https://") && env.NODE_ENV === "production") providerFailed(p, "OTP_HTTP_URL must use https");
      req = {
        url: env.OTP_HTTP_URL!,
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(env.OTP_HTTP_TOKEN ? { Authorization: `Bearer ${env.OTP_HTTP_TOKEN}` } : {}) },
          body: JSON.stringify({ phone: to, code, purpose, text }),
        },
      };
      break;
    default:
      providerFailed(p || "(none)", "unknown OTP_PROVIDER");
  }
  let r: Response;
  try { r = await fetch(req.url, { ...req.init, signal: AbortSignal.timeout(15_000) }); }
  catch (e) { providerFailed(p, `network error (${(e as Error).name})`); }
  if (!r.ok) providerFailed(p, `HTTP ${r.status}`);
  if (p === "msg91") {
    const j = (await r.json().catch(() => null)) as { type?: string; message?: string } | null;
    if (j?.type === "error") providerFailed(p, `rejected (${String(j.message ?? "").slice(0, 120)})`);
  }
}

/**
 * Caps how many codes go to one phone or email (5 per 15 minutes) and how many one client IP can request
 * (20 per 15 minutes). Call before looking the contact up, so the limit says nothing about whether it exists.
 */
export async function throttleSend(target: string) {
  const { ip } = await clientInfo();
  const wait = await rateLimit([{ key: "send:" + target, max: 5 }, ...(ip ? [{ key: "sendip:" + ip, max: 20 }] : [])]);
  if (wait) throw new UserError(`Too many codes requested. Try again in ${wait} minute${wait > 1 ? "s" : ""}.`);
}

/** Sign-in and invite codes: single use, 5-minute expiry, 5 attempts. */
export async function sendOtp(phone: string, purpose: "signin" | "invite"): Promise<void> {
  const code = newCode();
  const data = { codeHash: hashCode(phone, code), purpose, attempts: 0, expiresAt: new Date(Date.now() + 5 * 60_000) };
  await db.otpCode.upsert({ where: { phone }, create: { phone, ...data }, update: data });
  try { await deliverSms(phone, code, purpose, 5); }
  catch (e) { await db.otpCode.deleteMany({ where: { phone } }); throw e; }
}

export async function verifyOtp(phone: string, code: string, purpose: "signin" | "invite" | "signup"): Promise<{ ok: true } | { ok: false; left: number }> {
  const r = await db.otpCode.findUnique({ where: { phone } });
  if (!r || r.purpose !== purpose || r.expiresAt < new Date() || r.attempts >= 5) return { ok: false, left: 0 };
  if (/^\d{6}$/.test(code) && sameHash(r.codeHash, hashCode(phone, code))) {
    const used = await db.otpCode.deleteMany({ where: { phone, codeHash: r.codeHash } });
    return used.count ? { ok: true } : { ok: false, left: 0 };
  }
  await db.otpCode.update({ where: { phone }, data: { attempts: { increment: 1 } } });
  return { ok: false, left: 4 - r.attempts };
}
