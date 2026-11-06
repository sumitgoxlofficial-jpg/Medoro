import { checkUnsub, unsubscribe } from "@/staff/growth/comms";

export const dynamic = "force-dynamic";

const page = (title: string, body: string, status = 200) => new Response(
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title></head><body style="font-family:system-ui,sans-serif;max-width:480px;margin:48px auto;padding:0 16px;color:#1F2328;line-height:1.5"><h1 style="font-size:20px">${title}</h1>${body}</body></html>`,
  { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } },
);
const esc = (s: string) => s.replace(/[^a-zA-Z0-9._-]/g, "");

/** Shows a confirmation button: link scanners that only GET never unsubscribe anyone. */
export async function GET(req: Request) {
  const u = new URL(req.url);
  const l = esc(u.searchParams.get("l") ?? ""), c = esc(u.searchParams.get("c") ?? ""), t = esc(u.searchParams.get("t") ?? "");
  if (!l || !checkUnsub(l, c, t)) return page("Link not valid", "<p>This unsubscribe link is incomplete or has been changed.</p>", 400);
  return page("Stop messages from Medoro?", `<p>We’ll stop sending ${c === "email" ? "emails" : "WhatsApp messages"} about Medoro to this pharmacy.</p><form method="post"><input type="hidden" name="l" value="${l}"><input type="hidden" name="c" value="${c}"><input type="hidden" name="t" value="${t}"><button style="padding:10px 16px;border-radius:8px;border:0;background:#0B5E5B;color:#fff;font-weight:600">Unsubscribe</button></form>`);
}

/** Form POST from the page above, or one-click List-Unsubscribe-Post (query parameters). */
export async function POST(req: Request) {
  const u = new URL(req.url);
  const fd = await req.formData().catch(() => null);
  const get = (k: string) => esc(String(fd?.get(k) ?? u.searchParams.get(k) ?? ""));
  const ok = await unsubscribe(get("l"), get("c"), get("t"));
  return ok ? page("You’re unsubscribed", "<p>Medoro won’t send you these messages again. Thank you.</p>") : page("Link not valid", "<p>This unsubscribe link is incomplete or has been changed.</p>", 400);
}
