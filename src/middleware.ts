import { NextResponse, type NextRequest } from "next/server";
import { securityHeaders } from "@/server/security-headers";

/** Per-request CSP nonce plus security headers. Authentication is enforced in pages and handlers, not here. */
export function middleware(req: NextRequest) {
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
