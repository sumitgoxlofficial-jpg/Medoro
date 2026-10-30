export type HeaderOpts = { nonce: string; https: boolean; path: string; dev?: boolean };

/** Paths a Medoro page may embed in an iframe (the scanned-invoice preview). Everything else refuses framing. */
const FRAMEABLE = /^\/api\/documents\//;

export function contentSecurityPolicy({ nonce, https, path, dev }: HeaderOpts): string {
  const frameable = FRAMEABLE.test(path);
  const d: [string, string][] = [
    ["default-src", "'self'"],
    ["script-src", `'self' 'nonce-${nonce}' 'strict-dynamic'${dev ? " 'unsafe-eval'" : ""}`],
    ["style-src", "'self' 'unsafe-inline'"],
    ["img-src", "'self' data: blob:"],
    ["font-src", "'self' data:"],
    ["connect-src", dev ? "'self' ws: wss:" : "'self'"],
    ["worker-src", "'self'"],
    ["manifest-src", "'self'"],
    ["frame-src", "'self'"],
    ["object-src", "'none'"],
    ["base-uri", "'self'"],
    // Google sign-in for Drive backups is a top-level redirect started from our own pages.
    ["form-action", "'self' https://accounts.google.com"],
    ["frame-ancestors", frameable ? "'self'" : "'none'"],
  ];
  if (https) d.push(["upgrade-insecure-requests", ""]);
  return d.map(([k, v]) => (v ? `${k} ${v}` : k)).join("; ");
}

export function securityHeaders(o: HeaderOpts): Record<string, string> {
  const h: Record<string, string> = {
    "Content-Security-Policy": contentSecurityPolicy(o),
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Permissions-Policy": "camera=(self), microphone=(), geolocation=(), payment=(), usb=(), browsing-topics=()",
    "X-Frame-Options": FRAMEABLE.test(o.path) ? "SAMEORIGIN" : "DENY",
    "Cross-Origin-Opener-Policy": "same-origin",
  };
  if (o.https && process.env.DISABLE_HSTS !== "1") h["Strict-Transport-Security"] = "max-age=63072000; includeSubDomains";
  return h;
}
