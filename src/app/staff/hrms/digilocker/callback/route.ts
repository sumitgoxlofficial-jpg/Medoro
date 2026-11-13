import { UserError } from "@/server/action";
import { log } from "@/server/log";
import { finishVerify } from "@/staff/hrms/digilocker";

export const dynamic = "force-dynamic";

/**
 * DigiLocker sends the employee back here. The staff cookie is SameSite=Strict and isn't sent on a navigation that
 * comes from another site, so the employee is identified by the sealed flow cookie set when they started, and the answer
 * is a tiny page that moves on with a fresh same-site request (as the Google connection does).
 */
export async function GET(req: Request) {
  const u = new URL(req.url);
  let q: string;
  // The check always runs: what the URL says never decides whether it happens. When DigiLocker reports a refusal there
  // is no code, so the check fails safe, and the message says it was a refusal.
  try {
    const r = await finishVerify(u.searchParams.get("code") ?? "", u.searchParams.get("state") ?? "");
    q = r.result === "verified" ? "digilocker=verified" : "digilocker=review&why=" + encodeURIComponent(r.why.join(" "));
  } catch (e) {
    if (!(e instanceof UserError)) log.error("digilocker verify failed", { err: e });
    q = u.searchParams.has("error") ? "digilocker=denied" : "digilocker=failed&why=" + encodeURIComponent(e instanceof UserError ? e.message : "Something went wrong. Try again, or upload your Aadhaar card.");
  }
  const next = `/staff/hrms?${q}`.replace(/&/g, "&amp;").replace(/"/g, "&quot;");
  return new Response(`<!doctype html><html><head><meta charset="utf-8"><meta http-equiv="refresh" content="0;url=${next}"><title>Checking…</title></head><body style="font-family:system-ui;padding:2rem"><p>Checking your Aadhaar… <a href="${next}">Continue</a></p></body></html>`, {
    headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "referrer-policy": "no-referrer" },
  });
}
