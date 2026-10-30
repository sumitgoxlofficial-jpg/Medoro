import "server-only";
import { toE164 } from "./otp";

// Plain text SMS (order updates) through the same gateways as sign-in codes. SMS_PROVIDER defaults to
// OTP_PROVIDER. msg91 needs a separate DLT-approved Flow template with a ##text## variable (SMS_TEMPLATE_ID).
type Env = Record<string, string | undefined>;

const providerOf = (env: Env) => (env.SMS_PROVIDER || env.OTP_PROVIDER || "").trim().toLowerCase();

export function smsEnabled(env: Env = process.env) {
  const p = providerOf(env);
  if (!p) return false;
  if (p === "console") return env.NODE_ENV !== "production";
  if (p === "msg91") return !!(env.OTP_API_KEY && env.SMS_TEMPLATE_ID);
  if (p === "twilio") return !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM);
  if (p === "http") return !!(env.SMS_HTTP_URL || env.OTP_HTTP_URL);
  return false;
}

/** Sends one SMS. Throws an Error with the provider's reason on failure. */
export async function sendSms(phone: string, text: string, env: Env = process.env) {
  const to = toE164(phone), p = providerOf(env);
  if (!smsEnabled(env)) throw new Error(`SMS is not configured (${p || "no provider"})`);
  let req: { url: string; init: RequestInit };
  switch (p) {
    case "console":
      console.info(`[sms] to ${to}: ${text}`);
      return;
    case "msg91":
      req = {
        url: "https://control.msg91.com/api/v5/flow",
        init: {
          method: "POST",
          headers: { authkey: env.OTP_API_KEY!, "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify({ template_id: env.SMS_TEMPLATE_ID, short_url: "0", ...(env.OTP_SENDER ? { sender: env.OTP_SENDER } : {}), recipients: [{ mobiles: to.slice(1), text }] }),
        },
      };
      break;
    case "twilio": {
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
    default: {
      const url = env.SMS_HTTP_URL || env.OTP_HTTP_URL!, token = env.SMS_HTTP_URL ? env.SMS_HTTP_TOKEN : env.OTP_HTTP_TOKEN;
      if (!url.startsWith("https://") && env.NODE_ENV === "production") throw new Error("SMS webhook must use https");
      req = { url, init: { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ phone: to, purpose: "message", text }) } };
    }
  }
  const r = await fetch(req.url, { ...req.init, signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`${p}: HTTP ${r.status}`);
  if (p === "msg91") {
    const j = (await r.json().catch(() => null)) as { type?: string; message?: string } | null;
    if (j?.type === "error") throw new Error(`msg91: ${String(j.message ?? "rejected").slice(0, 120)}`);
  }
}
