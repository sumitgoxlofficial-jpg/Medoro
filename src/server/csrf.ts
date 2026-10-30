/**
 * CSRF guard for cookie-authenticated, state-changing route handlers. Browsers always send Origin on
 * cross-site POST/PUT/DELETE and Sec-Fetch-Site on modern versions; a request from another site fails here.
 * Requests with neither header can't come from a victim's browser page, so they pass (curl, server jobs).
 * Server actions get the same Origin check from Next.js itself.
 */
export function allowedHosts(req: Request): Set<string> {
  const hosts = new Set<string>();
  const add = (v: string | null | undefined) => { for (const h of (v ?? "").split(",")) { const t = h.trim().toLowerCase(); if (t) hosts.add(t); } };
  add(req.headers.get("x-forwarded-host"));
  add(req.headers.get("host"));
  try { if (process.env.APP_URL) hosts.add(new URL(process.env.APP_URL).host.toLowerCase()); } catch { /* ignore a malformed APP_URL */ }
  add(process.env.ALLOWED_ORIGINS);
  return hosts;
}

export function crossSiteReason(req: Request): string | null {
  const site = req.headers.get("sec-fetch-site");
  if (site && site !== "same-origin" && site !== "none") return `sec-fetch-site ${site}`;
  const origin = req.headers.get("origin");
  if (!origin) return null;
  let host: string;
  try { host = new URL(origin).host.toLowerCase(); } catch { return "bad origin"; }
  if (origin === "null" || !allowedHosts(req).has(host)) return "origin mismatch";
  return null;
}

/** Returns a 403 response for cross-site requests, otherwise null. */
export function rejectCrossSite(req: Request): Response | null {
  return crossSiteReason(req) ? new Response("Cross-site request blocked.", { status: 403, headers: { "Cache-Control": "no-store" } }) : null;
}
