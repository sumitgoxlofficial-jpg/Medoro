import { unsubscribe } from "@/domain/reports/mailer";

export const dynamic = "force-dynamic";

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const page = (body: string, status = 200) => new Response(
  `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Medoro · report emails</title>
<style>body{font:15px/1.5 system-ui,sans-serif;background:#F5F6F7;color:#1D2328;display:flex;justify-content:center;padding:48px 16px;margin:0}main{background:#fff;border:1px solid #E6E8EB;border-radius:12px;padding:24px;max-width:420px}button{background:#0B5E5B;color:#fff;border:0;border-radius:8px;padding:10px 16px;font-size:15px;cursor:pointer}</style></head><body><main>${body}</main></body></html>`,
  { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex" } },
);
const params = (u: URL) => ({ t: u.searchParams.get("t") ?? "", e: u.searchParams.get("e") ?? "", s: u.searchParams.get("s") ?? "" });

/** Shows a confirm button: mail scanners that open links must not unsubscribe anyone. */
export async function GET(req: Request) {
  const { t, e, s } = params(new URL(req.url));
  if (!t || !e || !s) return page("<h1>Link incomplete</h1><p>Open the link from the email again.</p>", 400);
  return page(`<h1>Stop report emails?</h1><p><b>${esc(e)}</b> will no longer get this pharmacy’s scheduled reports from Medoro.</p><form method="post"><button type="submit">Unsubscribe</button></form>`);
}

export async function POST(req: Request) {
  const { t, e, s } = params(new URL(req.url));
  const ok = t && e && s ? await unsubscribe(t, e, s).catch(() => false) : false;
  return ok
    ? page(`<h1>Unsubscribed</h1><p>${esc(e)} won’t get scheduled reports any more. The owner can add it again in Medoro.</p>`)
    : page("<h1>Link not valid</h1><p>This unsubscribe link is incomplete or was changed. Ask the pharmacy owner to remove you.</p>", 400);
}
