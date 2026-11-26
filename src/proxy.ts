import { NextResponse, type NextRequest } from "next/server";
import { securityHeaders } from "@/server/security-headers";
import { checkVideoPass, VIDEO_PASS_COOKIE, videoSlugOf } from "@/lib/hrms-video-pass";

/**
 * Per-request CSP nonce plus security headers. Authentication is enforced in pages and handlers, not here, with one
 * exception: the HRMS training videos are static files (public/hrms-videos), so they are served only to a browser
 * holding a staff video pass that covers that video (lib/hrms-video-pass.ts).
 */
export async function proxy(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith("/hrms-videos/")) {
    const slug = videoSlugOf(req.nextUrl.pathname);
    const ok = slug ? await checkVideoPass(process.env.SESSION_SECRET ?? "", req.cookies.get(VIDEO_PASS_COOKIE)?.value, slug) : false;
    if (!ok) return new NextResponse("Not found", { status: 404, headers: { "cache-control": "no-store" } });
    const res = NextResponse.next();
    res.headers.set("cache-control", "private, max-age=3600");
    res.headers.set("x-content-type-options", "nosniff");
    return res;
  }
  const nonce = btoa(crypto.randomUUID());
  const https = req.nextUrl.protocol === "https:" || req.headers.get("x-forwarded-proto")?.split(",")[0].trim() === "https";
  const headers = securityHeaders({ nonce, https, path: req.nextUrl.pathname, dev: process.env.NODE_ENV === "development" });
  const reqHeaders = new Headers(req.headers);
  reqHeaders.set("x-nonce", nonce);
  reqHeaders.set("content-security-policy", headers["Content-Security-Policy"]);
  const res = NextResponse.next({ request: { headers: reqHeaders } });
  for (const [k, v] of Object.entries(headers)) res.headers.set(k, v);
  return res;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image).*)"],
};
