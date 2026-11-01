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

  it("allows Razorpay Checkout inside the signed-in app only", () => {
    const app = securityHeaders({ nonce: "n", https: true, path: "/app/plan" });
    expect(app["Content-Security-Policy"]).toContain("frame-src 'self' https://checkout.razorpay.com https://api.razorpay.com");
    expect(app["Cross-Origin-Opener-Policy"]).toBe("same-origin-allow-popups");
    const site = securityHeaders({ nonce: "n", https: true, path: "/signin" });
    expect(site["Content-Security-Policy"]).not.toContain("razorpay");
    expect(site["Cross-Origin-Opener-Policy"]).toBe("same-origin");
    expect(contentSecurityPolicy({ nonce: "n", https: false, path: "/application" })).not.toContain("razorpay");
  });

  it("lets only the DriveDB worker run WebAssembly and reach Google Drive", () => {
    const w = contentSecurityPolicy({ nonce: "n", https: true, path: "/drivedb/bench-worker.mjs" });
    expect(w).toContain("script-src 'self' 'wasm-unsafe-eval'");
    expect(w).toContain("connect-src 'self' https://www.googleapis.com");
    for (const path of ["/app", "/app/lab", "/"]) {
      const p = contentSecurityPolicy({ nonce: "n", https: true, path });
      expect(p).not.toContain("wasm-unsafe-eval");
      expect(p).not.toContain("googleapis");
    }
  });
});
