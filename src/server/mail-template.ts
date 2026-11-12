/** Professional email layout: one look for every message Medoro sends. Pure (no server code), so it can be tested. */

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
/** Escaped, with web addresses made clickable. */
const rich = (s: string) => esc(s).replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)])/g, '<a href="$1" style="color:#0B5E5B">$1</a>').replace(/\n/g, "<br>");

export type Block =
  | { p: string }
  | { facts: [string, string][] }
  | { code: string; note?: string }
  | { button: { label: string; url: string } }
  | { note: string };

export type Composed = { greeting?: string; blocks: Block[]; signoff?: { name: string; org?: string } | null; /** Mentions passwords or codes: adds the "never share" line to the footer. Set automatically when the email has a code. */ secure?: boolean };

/** The logo is served from the app itself (public/email-logo.png). */
const logoUrl = () => `${(process.env.APP_URL?.trim() || "https://medoro.in").replace(/\/$/, "")}/email-logo.png`;

const FOOT = "This is an automated message from Medoro.";
const FOOT_SECURE = "This is an automated message from Medoro. Please do not share your password or one-time code with anyone.";

/** Plain-text version, for mail apps that don't show formatted email and for the server log. */
export function composeText(c: Composed): string {
  const out: string[] = [];
  if (c.greeting) out.push(c.greeting);
  for (const b of c.blocks) {
    if ("p" in b) out.push(b.p);
    else if ("facts" in b) out.push(b.facts.map(([k, v]) => `${k}: ${v}`).join("\n"));
    else if ("code" in b) out.push(`${b.code}${b.note ? `\n${b.note}` : ""}`);
    else if ("button" in b) out.push(`${b.button.label}: ${b.button.url}`);
    else out.push(b.note);
  }
  if (c.signoff !== null) out.push(`Warm regards,\n${c.signoff?.name ?? "Medoro"}${c.signoff?.org ? `\n${c.signoff.org}` : ""}`);
  return out.join("\n\n");
}

/** The branded HTML version: header bar, readable body, tidy details table, footer. */
export function composeHtml(c: Composed, subject: string): string {
  const body = c.blocks.map((b) => {
    if ("p" in b) return `<p style="margin:0 0 16px;line-height:1.6">${rich(b.p)}</p>`;
    if ("facts" in b) return `<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%;margin:0 0 18px;border:1px solid #E3E7EB;border-radius:8px;border-collapse:separate">${b.facts.map(([k, v], i) => `<tr><td style="padding:9px 14px;color:#5B6670;font-size:13px;width:38%;${i ? "border-top:1px solid #EEF1F3;" : ""}">${esc(k)}</td><td style="padding:9px 14px;font-weight:600;font-size:14px;${i ? "border-top:1px solid #EEF1F3;" : ""}">${esc(v)}</td></tr>`).join("")}</table>`;
    if ("code" in b) return `<div style="margin:0 0 18px;text-align:center"><div style="display:inline-block;padding:12px 26px;background:#F1F7F6;border:1px solid #CFE3E1;border-radius:8px;font-size:26px;letter-spacing:6px;font-weight:700;color:#0B5E5B">${esc(b.code)}</div>${b.note ? `<div style="margin-top:8px;font-size:13px;color:#5B6670">${esc(b.note)}</div>` : ""}</div>`;
    if ("button" in b) return `<p style="margin:0 0 18px"><a href="${esc(b.button.url)}" style="display:inline-block;padding:11px 22px;background:#0B5E5B;color:#fff;text-decoration:none;border-radius:8px;font-weight:600;font-size:14px">${esc(b.button.label)}</a></p>`;
    return `<p style="margin:0 0 16px;padding:10px 14px;background:#F7F8FA;border-left:3px solid #0B5E5B;border-radius:4px;font-size:13px;line-height:1.55;color:#3A444C">${rich(b.note)}</p>`;
  }).join("");
  const sign = c.signoff === null ? "" : `<p style="margin:22px 0 0;line-height:1.55">Warm regards,<br><strong>${esc(c.signoff?.name ?? "Medoro")}</strong>${c.signoff?.org ? `<br><span style="color:#5B6670">${esc(c.signoff.org)}</span>` : ""}</p>`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(subject)}</title></head>
<body style="margin:0;padding:0;background:#F3F5F7;font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#1B232A">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F3F5F7"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#fff;border:1px solid #E3E7EB;border-radius:12px;overflow:hidden">
<tr><td style="padding:18px 28px;border-bottom:3px solid #0B5E5B"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="padding-right:12px;vertical-align:middle"><img src="${logoUrl()}" width="44" alt="Medoro" style="display:block;border:0;height:auto"></td><td style="vertical-align:middle;font-size:22px;font-weight:700;letter-spacing:.3px;color:#0B3A7A">Med<span style="color:#0E9A80">oro</span></td></tr></table></td></tr>
<tr><td style="padding:28px 28px 8px;font-size:15px">${c.greeting ? `<p style="margin:0 0 16px;font-weight:600">${esc(c.greeting)}</p>` : ""}${body}${sign}</td></tr>
<tr><td style="padding:16px 28px 22px;color:#7A858E;font-size:12px;line-height:1.5;border-top:1px solid #EEF1F3">${esc(c.secure || c.blocks.some((b) => "code" in b) ? FOOT_SECURE : FOOT)}</td></tr>
</table></td></tr></table></body></html>`;
}

export function compose(c: Composed, subject: string) {
  return { text: composeText(c), html: composeHtml(c, subject) };
}

/** Any plain message in the same layout: paragraphs split on blank lines, the first "Dear/Hi ..." line used as the greeting. */
export function fromText(text: string, subject: string) {
  const paras = text.trim().split(/\n{2,}/);
  const greeting = /^(dear|hi|hello)\b[^\n]*[,:]?$/i.test(paras[0] ?? "") ? paras.shift()! : undefined;
  return composeHtml({ greeting, blocks: paras.map((p) => ({ p })), signoff: null }, subject);
}
