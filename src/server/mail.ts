import "server-only";
import { UserError } from "./action";

// Email goes out through MAIL_PROVIDER: resend, sendgrid, http (alias smtp-http: your own webhook or SMTP
// relay), or console (prints messages to the server log; refused in production). Blank disables email.
type Env = Record<string, string | undefined>;
export type Attachment = { filename: string; content: Buffer | string; contentType?: string };
export type Mail = { to: string; subject: string; text: string; attachments?: Attachment[] };

const b64 = (a: Attachment) => (typeof a.content === "string" ? Buffer.from(a.content, "utf8") : a.content).toString("base64");
const typeOf = (a: Attachment) => a.contentType ?? "application/octet-stream";

const providerOf = (env: Env) => (env.MAIL_PROVIDER ?? "").trim().toLowerCase();

export const mailEnabled = (env: Env = process.env) => {
  const p = providerOf(env);
  if (!p) return false;
  return p === "console" ? env.NODE_ENV !== "production" : !!env.MAIL_FROM;
};

/** "Medoro <no-reply@x.in>" → { name, email }. */
export function parseFrom(from: string) {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  return m ? { name: m[1].replace(/^"|"$/g, "") || undefined, email: m[2].trim() } : { name: undefined, email: from.trim() };
}

function providerFailed(provider: string, detail: string): never {
  console.error(`[mail] ${provider} send failed: ${detail}`);
  throw new UserError("Couldn’t send the email, try again.");
}

export async function sendMail(m: Mail, env: Env = process.env) {
  const p = providerOf(env), from = env.MAIL_FROM ?? "";
  const att = m.attachments?.length ? m.attachments : null;
  const need = (...ks: string[]) => { const miss = ks.filter((k) => !env[k]); if (miss.length) providerFailed(p, `${miss.join(", ")} not set`); };
  let req: { url: string; init: RequestInit };
  switch (p) {
    case "console":
      if (env.NODE_ENV === "production") providerFailed(p, "the console provider is for local development only");
      console.info(`[mail] to ${m.to} · ${m.subject}\n${m.text}${att ? `\n[attachments] ${att.map((a) => a.filename).join(", ")}` : ""}`);
      return;
    case "resend":
      need("RESEND_API_KEY", "MAIL_FROM");
      req = {
        url: "https://api.resend.com/emails",
        init: { method: "POST", headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ from, to: [m.to], subject: m.subject, text: m.text, ...(att ? { attachments: att.map((a) => ({ filename: a.filename, content: b64(a), content_type: typeOf(a) })) } : {}) }) },
      };
      break;
    case "sendgrid":
      need("SENDGRID_API_KEY", "MAIL_FROM");
      req = {
        url: "https://api.sendgrid.com/v3/mail/send",
        init: {
          method: "POST",
          headers: { Authorization: `Bearer ${env.SENDGRID_API_KEY}`, "Content-Type": "application/json" },
          body: JSON.stringify({ personalizations: [{ to: [{ email: m.to }] }], from: parseFrom(from), subject: m.subject, content: [{ type: "text/plain", value: m.text }], ...(att ? { attachments: att.map((a) => ({ content: b64(a), filename: a.filename, type: typeOf(a), disposition: "attachment" })) } : {}) }),
        },
      };
      break;
    case "http":
    case "smtp-http":
      need("MAIL_HTTP_URL", "MAIL_FROM");
      if (!env.MAIL_HTTP_URL!.startsWith("https://") && env.NODE_ENV === "production") providerFailed(p, "MAIL_HTTP_URL must use https");
      req = {
        url: env.MAIL_HTTP_URL!,
        init: {
          method: "POST",
          headers: { "Content-Type": "application/json", ...(env.MAIL_HTTP_TOKEN ? { Authorization: `Bearer ${env.MAIL_HTTP_TOKEN}` } : {}) },
          body: JSON.stringify({ from, to: m.to, subject: m.subject, text: m.text, ...(att ? { attachments: att.map((a) => ({ filename: a.filename, contentType: typeOf(a), content: b64(a) })) } : {}) }),
        },
      };
      break;
    default:
      providerFailed(p || "(none)", "unknown MAIL_PROVIDER");
  }
  let r: Response;
  try { r = await fetch(req.url, { ...req.init, signal: AbortSignal.timeout(15_000) }); }
  catch (e) { providerFailed(p, `network error (${(e as Error).name})`); }
  if (!r.ok) providerFailed(p, `HTTP ${r.status}`);
}
