import { describe, expect, it, vi } from "vitest";

vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => ({ value: "setup.expected-state.verifier" }), delete: () => {} }),
}));

const { GET } = await import("@/app/api/integrations/google/callback/route");

describe("Drive setup popup", () => {
  it("tags its inline script with the request's CSP nonce", async () => {
    const res = await GET(new Request("https://pharmacy.example.in/api/integrations/google/callback?state=other", { headers: { "x-nonce": "YWJjZA==" } }));
    const html = await res.text();
    expect(html).toContain('<script nonce="YWJjZA==">');
    expect(html).toContain('postMessage("state")');
  });

  it("never echoes a malformed nonce", async () => {
    const res = await GET(new Request("https://pharmacy.example.in/api/integrations/google/callback?state=other", { headers: { "x-nonce": '"><script>x' } }));
    expect(await res.text()).toContain("<script>try{");
  });
});
