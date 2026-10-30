import { afterEach, describe, expect, it } from "vitest";
import { crossSiteReason, rejectCrossSite } from "./csrf";

const req = (h: Record<string, string>) => new Request("http://shop.local:3000/api/offline/sync", { method: "POST", headers: { host: "shop.local:3000", ...h } });

describe("CSRF guard for route handlers", () => {
  afterEach(() => { delete process.env.APP_URL; delete process.env.ALLOWED_ORIGINS; });

  it("allows same-origin browser requests and non-browser clients", () => {
    expect(crossSiteReason(req({ origin: "http://shop.local:3000", "sec-fetch-site": "same-origin" }))).toBeNull();
    expect(crossSiteReason(req({}))).toBeNull();
  });

  it("blocks other sites by Origin or Sec-Fetch-Site", () => {
    expect(crossSiteReason(req({ origin: "https://evil.example" }))).toBe("origin mismatch");
    expect(crossSiteReason(req({ origin: "null" }))).toBeTruthy();
    expect(crossSiteReason(req({ "sec-fetch-site": "cross-site" }))).toMatch(/cross-site/);
    expect(crossSiteReason(req({ "sec-fetch-site": "same-site", origin: "http://other.shop.local:3000" }))).toBeTruthy();
    expect(rejectCrossSite(req({ origin: "https://evil.example" }))?.status).toBe(403);
  });

  it("accepts APP_URL and ALLOWED_ORIGINS behind a proxy", () => {
    process.env.APP_URL = "https://pharmacy.example.in";
    process.env.ALLOWED_ORIGINS = "medoro.local:8443";
    expect(crossSiteReason(req({ origin: "https://pharmacy.example.in" }))).toBeNull();
    expect(crossSiteReason(req({ origin: "https://medoro.local:8443" }))).toBeNull();
  });
});
