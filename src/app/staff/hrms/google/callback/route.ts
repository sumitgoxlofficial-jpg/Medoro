import { UserError } from "@/server/action";
import { log } from "@/server/log";
import { finishConnect } from "@/staff/hrms/gcal";

export const dynamic = "force-dynamic";

/**
 * Google sends the employee back here. The staff cookie is SameSite=Strict and isn't sent on a navigation that comes
 * from another site, so the employee is identified by the sealed flow cookie set when they started, and the answer is a
 * tiny page that moves on to the calendar with a fresh, same-site request (as the staff sign-in does).
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  let result = "error", purpose = "calendar";
  if (u.searchParams.get("error")) result = "denied";
  else {
    try { purpose = await finishConnect(u.searchParams.get("code") ?? "", u.searchParams.get("state") ?? ""); result = "connected"; }
    catch (e) { if ((e as { purpose?: string }).purpose === "backup") purpose = "backup"; if (!(e instanceof UserError)) log.error("google connect failed", { err: e }); result = e instanceof UserError ? "failed&why=" + encodeURIComponent(e.message) : "error"; }
  }
  const next = purpose === "backup" ? `/staff/hrms/chat?backup=${result}` : `/staff/hrms/calendar?google=${result}`;
  const esc = next.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${esc}"><title>Connecting…</title></head><body style="font-family:system-ui;padding:2rem"><p>Connecting Google Calendar… <a href="${esc}">Continue</a></p></body></html>`, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" },
  });
}
