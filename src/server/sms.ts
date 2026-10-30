import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { UserError } from "./action";
import { toE164 } from "./otp";

// Customer SMS (reminders, store updates, loyalty) and plain-text order updates through the same gateway as
// sign-in codes: SMS_PROVIDER, or OTP_PROVIDER when that's blank, with the OTP_* / TWILIO_* credentials (the http
// gateway may have its own SMS_HTTP_URL / SMS_HTTP_TOKEN). Indian DLT rules apply: msg91 sends a Flow template
// (per message type, chosen in Customer messaging, or SMS_TEMPLATE_ID with a ##text## variable for order updates)
// with ##var1##, ##var2##… filled in; twilio and http send the plain text, which must match the DLT template
// registered for your sender.
type Env = Record<string, string | undefined>;
export type SmsType = "refill" | "payment" | "campaign" | "loyalty";
export const SMS_TYPES: SmsType[] = ["refill", "payment", "campaign", "loyalty"];

export const smsProvider = (env: Env = process.env) => (env.SMS_PROVIDER || env.OTP_PROVIDER || "").trim().toLowerCase();
export const smsAvailable = (env: Env = process.env) => {
  const p = smsProvider(env);
  return ["msg91", "twilio", "http", "console"].includes(p) && !(p === "console" && env.NODE_ENV === "production");
};
/** Whether plain-text updates (orders) can go out: a provider with its credentials, and for msg91 SMS_TEMPLATE_ID. */
export function smsEnabled(env: Env = process.env) {
  const p = smsProvider(env);
  if (!p) return false;
  if (p === "console") return env.NODE_ENV !== "production";
  if (p === "msg91") return !!(env.OTP_API_KEY && env.SMS_TEMPLATE_ID);
  if (p === "twilio") return !!(env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM);
  if (p === "http") return !!(env.SMS_HTTP_URL || env.OTP_HTTP_URL);
  return false;
}
/** msg91 needs a DLT-linked Flow template per message type; the others send text. */
export const smsNeedsTemplate = (env: Env = process.env) => smsProvider(env) === "msg91";

export class SmsError extends UserError {
  constructor(message: string, readonly retry: boolean) { super(message); }
}

/** Message text for each type; vars are the same values msg91 gets as var1, var2… */
export function smsText(type: SmsType, v: string[], pharmacy: string) {
  const s = {
    refill: `Hi ${v[0]}, your ${v[1]} may be running out around ${v[2]}. Visit ${pharmacy} to refill.`,
    payment: `Hi ${v[0]}, Rs ${v[1]} is due on your account at ${pharmacy}. Please clear it on your next visit.`,
    campaign: `Hi ${v[0]}, ${v[1] ?? ""} - ${pharmacy}`,
    loyalty: `Hi ${v[0]}, you earned ${v[1]} points at ${pharmacy}. Balance ${v[2]} points.`,
  }[type];
  return `${s.replace(/\s+/g, " ").trim()} Reply STOP to opt out.`.slice(0, 480);
}

export type SmsMessage = { text: string; vars: string[]; template?: string; type: SmsType };

/**
 * Sends one SMS and returns the provider's message id. A string is a plain-text update (orders: msg91 sends it as
 * ##text## of SMS_TEMPLATE_ID); a message is a customer SMS of one type with its DLT template and variables.
 * Throws SmsError (retry: temporary failure).
 */
export async function sendSms(phone: string, m: string | SmsMessage, env: Env = process.env): Promise<string> {
  const p = smsProvider(env), plain = typeof m === "string", text = plain ? m : m.text, type = plain ? "message" : m.type;
  let to: string;
  try { to = toE164(phone); } catch { throw new SmsError("Not a valid 10-digit Indian mobile number.", false); }
  const need = (...ks: string[]) => { const miss = ks.filter((k) => !env[k]); if (miss.length) throw new SmsError(`SMS isn’t set up: ${miss.join(", ")} missing on the server.`, false); };
  if (plain && !smsEnabled(env)) throw new SmsError(`SMS is not configured (${p || "no provider"})`, false);
  let url: string, init: RequestInit;
  switch (p) {
    case "console":
      if (env.NODE_ENV === "production") throw new SmsError("The console SMS provider is for local development only.", false);
      console.info(`[sms] ${type} to ${to}: ${text}`);
      return "console";
    case "msg91": {
      need("OTP_API_KEY");
      const template = plain ? env.SMS_TEMPLATE_ID : m.template;
      if (!template) throw new SmsError(plain ? "Set SMS_TEMPLATE_ID (a DLT-linked MSG91 Flow template with ##text##) for order updates." : `Add the MSG91 template id for ${type} messages under Customer messaging.`, false);
      const vars = plain ? { text } : Object.fromEntries(m.vars.map((v, i) => [`var${i + 1}`, v]));
      url = "https://control.msg91.com/api/v5/flow";
      init = {
        method: "POST", headers: { authkey: env.OTP_API_KEY!, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ template_id: template, short_url: "0", ...(env.OTP_SENDER ? { sender: env.OTP_SENDER } : {}), recipients: [{ mobiles: to.slice(1), ...vars }] }),
      };
      break;
    }
    case "twilio": {
      need("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM");
      const from = env.TWILIO_FROM!;
      url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(env.TWILIO_ACCOUNT_SID!)}/Messages.json`;
      init = {
        method: "POST", headers: { Authorization: "Basic " + Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ To: to, Body: text, ...(from.startsWith("MG") ? { MessagingServiceSid: from } : { From: from }) }).toString(),
      };
      break;
    }
    case "http": {
      const hook = env.SMS_HTTP_URL || env.OTP_HTTP_URL, token = env.SMS_HTTP_URL ? env.SMS_HTTP_TOKEN : env.OTP_HTTP_TOKEN;
      if (!hook) need("OTP_HTTP_URL");
      if (!hook!.startsWith("https://") && env.NODE_ENV === "production") throw new SmsError("The SMS webhook (SMS_HTTP_URL or OTP_HTTP_URL) must use https.", false);
      url = hook!;
      const body = plain ? { phone: to, purpose: "message", text } : { phone: to, text, type, vars: m.vars, dltTemplateId: m.template ?? null };
      init = { method: "POST", headers: { "Content-Type": "application/json", ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) };
      break;
    }
    default:
      throw new SmsError("SMS isn’t set up on this server (SMS_PROVIDER / OTP_PROVIDER).", false);
  }
  let r: Response;
  try { r = await fetch(url, { ...init, signal: AbortSignal.timeout(15_000) }); }
  catch (e) { throw new SmsError(`SMS gateway unreachable (${(e as Error).name})`, true); }
  const j = (await r.json().catch(() => null)) as { type?: string; message?: string; sid?: string; id?: string } | null;
  if (!r.ok) throw new SmsError(`SMS gateway HTTP ${r.status}${j?.message ? `: ${String(j.message).slice(0, 120)}` : ""}`, r.status >= 500 || r.status === 429);
  if (p === "msg91" && j?.type === "error") throw new SmsError(`MSG91 rejected the message: ${String(j.message ?? "").slice(0, 120)}`, false);
  return String(j?.sid ?? j?.id ?? j?.message ?? "ok").slice(0, 120);
}

export const STOP_WORDS = ["STOP", "STOPALL", "UNSUBSCRIBE", "CANCEL", "END", "QUIT", "BAND"];

const sameStr = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Reads an inbound SMS webhook: Twilio (form post, X-Twilio-Signature checked with the auth token against
 * APP_URL/api/sms/inbound) or the http gateway (JSON {from, text} with Authorization: Bearer SMS_INBOUND_TOKEN).
 * Returns null when the request isn't authentic. MSG91 has no signed inbound webhook, so it isn't accepted.
 */
export function parseInbound(raw: string, headers: Headers, env: Env = process.env): { from: string; text: string } | null {
  const p = smsProvider(env);
  if (p === "twilio") {
    const sig = headers.get("x-twilio-signature") ?? "", tok = env.TWILIO_AUTH_TOKEN, base = env.APP_URL?.replace(/\/$/, "");
    if (!sig || !tok || !base) return null;
    const params = new URLSearchParams(raw);
    const data = `${base}/api/sms/inbound` + [...params.keys()].sort().map((k) => k + params.get(k)).join("");
    if (!sameStr(sig, createHmac("sha1", tok).update(data).digest("base64"))) return null;
    return { from: params.get("From") ?? "", text: params.get("Body") ?? "" };
  }
  if (p === "http" || p === "console") {
    const tok = env.SMS_INBOUND_TOKEN;
    if (!tok || !sameStr(headers.get("authorization") ?? "", `Bearer ${tok}`)) return null;
    try { const j = JSON.parse(raw) as { from?: string; text?: string }; return { from: String(j.from ?? ""), text: String(j.text ?? "") }; }
    catch { return null; }
  }
  return null;
}
