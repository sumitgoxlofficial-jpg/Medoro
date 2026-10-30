import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, securityHeaders } from "./security-headers";

describe("security headers", () => {
  it("builds a nonce-based CSP that refuses framing", () => {
    const csp = contentSecurityPolicy({ nonce: "abc", https: false, path: "/app" });
    expect(csp).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });

  it("lets our own pages frame document previews only", () => {
    expect(contentSecurityPolicy({ nonce: "n", https: false, path: "/api/documents/x" })).toContain("frame-ancestors 'self'");
    expect(securityHeaders({ nonce: "n", https: false, path: "/api/documents/x" })["X-Frame-Options"]).toBe("SAMEORIGIN");
  });

  it("adds HSTS only over HTTPS", () => {
    expect(securityHeaders({ nonce: "n", https: false, path: "/" })["Strict-Transport-Security"]).toBeUndefined();
    const h = securityHeaders({ nonce: "n", https: true, path: "/" });
    expect(h["Strict-Transport-Security"]).toMatch(/max-age=\d+/);
    expect(h["Content-Security-Policy"]).toContain("upgrade-insecure-requests");
    expect(h).toMatchObject({ "X-Content-Type-Options": "nosniff", "Referrer-Policy": "strict-origin-when-cross-origin", "X-Frame-Options": "DENY" });
  });
});
