import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeGoogle } from "../../tests/stubs/google";
import { exchangeCode, googleLogin, pkceChallenge, resetJwksCache, verifyIdToken } from "./google-oidc";

const CLIENT = "client-123.apps.googleusercontent.com";
const g = fakeGoogle();

describe("Google OIDC", () => {
  let calls: { url: string; init?: RequestInit }[];
  beforeEach(() => {
    resetJwksCache();
    calls = [];
    vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
      calls.push({ url, init });
      if (url === "https://www.googleapis.com/oauth2/v3/certs") return g.certs();
      if (url === "https://oauth2.googleapis.com/token") return Response.json({ id_token: "the-id-token", access_token: "at", token_type: "Bearer" });
      return new Response("not found", { status: 404 });
    });
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("uses the Drive OAuth client with its own login redirect, derived from APP_URL when not set", () => {
    const base = { GOOGLE_OAUTH_CLIENT_ID: "id", GOOGLE_OAUTH_CLIENT_SECRET: "s" };
    expect(googleLogin({ ...base, APP_URL: "https://p.example.in/" })?.redirect).toBe("https://p.example.in/api/auth/google/callback");
    expect(googleLogin({ ...base, APP_URL: "https://p.example.in", GOOGLE_LOGIN_REDIRECT_URI: "https://login.example/cb" })?.redirect).toBe("https://login.example/cb");
    expect(googleLogin({ ...base })).toBeNull();
    expect(googleLogin({ GOOGLE_OAUTH_CLIENT_ID: "id", APP_URL: "https://p.example.in" })).toBeNull();
  });

  it("PKCE S256 matches RFC 7636", () => {
    expect(pkceChallenge("dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk")).toBe("E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM");
  });

  it("exchanges the code server-side with the client secret, exact redirect URI and the PKCE verifier", async () => {
    const env = { GOOGLE_OAUTH_CLIENT_ID: CLIENT, GOOGLE_OAUTH_CLIENT_SECRET: "sec", GOOGLE_LOGIN_REDIRECT_URI: "https://p.example.in/api/auth/google/callback" };
    expect(await exchangeCode("auth-code", "the-verifier", env)).toBe("the-id-token");
    expect(calls[0].url).toBe("https://oauth2.googleapis.com/token");
    expect(calls[0].init?.method).toBe("POST");
    expect((calls[0].init?.headers as Record<string, string>)["Content-Type"]).toBe("application/x-www-form-urlencoded");
    expect(Object.fromEntries(new URLSearchParams(String(calls[0].init?.body)))).toEqual({
      code: "auth-code", client_id: CLIENT, client_secret: "sec", redirect_uri: "https://p.example.in/api/auth/google/callback", grant_type: "authorization_code", code_verifier: "the-verifier",
    });
  });

  it("verifies a good token, caching Google's keys by kid", async () => {
    const t = g.idToken(g.claims({ nonce: "n-1", name: "Owner Person", email: "Owner@Test.in" }));
    expect(await verifyIdToken(t, { clientId: CLIENT, nonce: "n-1" })).toEqual({ sub: "g-sub-1", email: "owner@test.in", name: "Owner Person" });
    await verifyIdToken(g.idToken(g.claims({ nonce: "n-2" })), { clientId: CLIENT, nonce: "n-2" });
    expect(calls.filter((c) => c.url.endsWith("/certs"))).toHaveLength(1);
  });

  it.each([
    ["wrong audience", { aud: "someone-else" }, /audience/],
    ["wrong issuer", { iss: "https://evil.example" }, /issuer/],
    ["expired", { exp: Math.floor(Date.now() / 1000) - 600 }, /expired/],
    ["nonce mismatch", { nonce: "other" }, /Nonce/],
    ["unverified email", { email_verified: false }, /not verified/],
  ])("rejects a token with %s", async (_name, over, err) => {
    await expect(verifyIdToken(g.idToken(g.claims({ nonce: "n", ...over })), { clientId: CLIENT, nonce: "n" })).rejects.toThrow(err);
  });

  it("rejects a forged signature, alg none and an unknown key", async () => {
    const good = g.idToken(g.claims({ nonce: "n" }));
    const [h, , s] = good.split(".");
    const forged = `${h}.${Buffer.from(JSON.stringify(g.claims({ nonce: "n", sub: "attacker" }))).toString("base64url")}.${s}`;
    await expect(verifyIdToken(forged, { clientId: CLIENT, nonce: "n" })).rejects.toThrow(/signature/);
    await expect(verifyIdToken(g.idToken(g.claims({ nonce: "n" }), { alg: "none" }), { clientId: CLIENT, nonce: "n" })).rejects.toThrow(/algorithm/);
    await expect(verifyIdToken(fakeGoogle("other-kid").idToken(g.claims({ nonce: "n" })), { clientId: CLIENT, nonce: "n" })).rejects.toThrow(/unknown key/);
  });
});
