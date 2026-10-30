import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { UserError } from "./action";

// Customer SMS (reminders, store updates, loyalty) through the same gateway as sign-in codes: SMS_PROVIDER,
// or OTP_PROVIDER when that's blank, with the OTP_* / TWILIO_* credentials. Indian DLT rules apply: msg91
// sends a Flow template (per message type, chosen in Customer messaging) with ##var1##, ##var2##… filled in;
// twilio and http send the plain text, which must match the DLT template registered for your sender.
type Env = Record<string, string | undefined>;
export type SmsType = "refill" | "payment" | "campaign" | "loyalty";
export const SMS_TYPES: SmsType[] = ["refill", "payment", "campaign", "loyalty"];

export const smsProvider = (env: Env = process.env) => (env.SMS_PROVIDER || env.OTP_PROVIDER || "").trim().toLowerCase();
export const smsAvailable = (env: Env = process.env) => {
  const p = smsProvider(env);
  return ["msg91", "twilio", "http", "console"].includes(p) && !(p === "console" && env.NODE_ENV === "production");
};
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

/** Sends one customer SMS. Returns the provider's message id. Throws SmsError (retry: temporary failure). */
export async function sendSms(phone: string, m: { text: string; vars: string[]; template?: string; type: SmsType }, env: Env = process.env): Promise<string> {
  const p = smsProvider(env), to = "+91" + phone;
  const need = (...ks: string[]) => { const miss = ks.filter((k) => !env[k]); if (miss.length) throw new SmsError(`SMS isn’t set up: ${miss.join(", ")} missing on the server.`, false); };
  let url: string, init: RequestInit;
  switch (p) {
    case "console":
      if (env.NODE_ENV === "production") throw new SmsError("The console SMS provider is for local development only.", false);
      console.info(`[sms] ${m.type} to ${to}: ${m.text}`);
      return "console";
    case "msg91":
      need("OTP_API_KEY");
      if (!m.template) throw new SmsError(`Add the MSG91 template id for ${m.type} messages under Customer messaging.`, false);
      url = "https://control.msg91.com/api/v5/flow";
      init = {
        method: "POST", headers: { authkey: env.OTP_API_KEY!, "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ template_id: m.template, short_url: "0", ...(env.OTP_SENDER ? { sender: env.OTP_SENDER } : {}), recipients: [{ mobiles: to.slice(1), ...Object.fromEntries(m.vars.map((v, i) => [`var${i + 1}`, v])) }] }),
      };
      break;
    case "twilio": {
      need("TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_FROM");
      const from = env.TWILIO_FROM!;
      url = `https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(env.TWILIO_ACCOUNT_SID!)}/Messages.json`;
      init = {
        method: "POST", headers: { Authorization: "Basic " + Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64"), "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ To: to, Body: m.text, ...(from.startsWith("MG") ? { MessagingServiceSid: from } : { From: from }) }).toString(),
      };
      break;
    }
    case "http":
      need("OTP_HTTP_URL");
      if (!env.OTP_HTTP_URL!.startsWith("https://") && env.NODE_ENV === "production") throw new SmsError("OTP_HTTP_URL must use https.", false);
      url = env.OTP_HTTP_URL!;
      init = { method: "POST", headers: { "Content-Type": "application/json", ...(env.OTP_HTTP_TOKEN ? { Authorization: `Bearer ${env.OTP_HTTP_TOKEN}` } : {}) }, body: JSON.stringify({ phone: to, text: m.text, type: m.type, vars: m.vars, dltTemplateId: m.template ?? null }) };
      break;
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
