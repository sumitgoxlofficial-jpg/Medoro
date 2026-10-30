import "server-only";
import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify, type KeyObject } from "node:crypto";
import { cookies } from "next/headers";
import { seal, unseal } from "./vault";

// "Sign in with Google": OpenID Connect authorization code flow with PKCE (S256), state and nonce.
// Uses the same OAuth client as Google Drive backups, with its own redirect URI.
type Env = Record<string, string | undefined>;
export type GoogleIntent = "signin" | "link";
export type GoogleClaims = { sub: string; email: string; name: string | null };

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const JWKS_URL = "https://www.googleapis.com/oauth2/v3/certs";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];
const FLOW_COOKIE = "medoro_goidc", LINK_COOKIE = "medoro_glink";
const FLOW_PATH = "/api/auth/google";
const SKEW_S = 60;

export class GoogleAuthError extends Error {}

export function googleLogin(env: Env = process.env) {
  const id = env.GOOGLE_OAUTH_CLIENT_ID, secret = env.GOOGLE_OAUTH_CLIENT_SECRET;
  const redirect = env.GOOGLE_LOGIN_REDIRECT_URI || (env.APP_URL ? env.APP_URL.replace(/\/+$/, "") + "/api/auth/google/callback" : "");
  return id && secret && redirect ? { id, secret, redirect } : null;
}
export const googleLoginConfigured = (env: Env = process.env) => !!googleLogin(env);

const b64u = (b: Buffer) => b.toString("base64url");
export const pkceChallenge = (verifier: string) => b64u(createHash("sha256").update(verifier).digest());
export const safeEqual = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const cookieOpts = (path: string, maxAge: number) => ({ httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path, maxAge });
const sealJson = (v: unknown) => b64u(seal(JSON.stringify(v)));
function openJson<T>(v: string | undefined): T | null {
  if (!v) return null;
  try { return JSON.parse(unseal(Buffer.from(v, "base64url")).toString()) as T; } catch { return null; }
}

/** Starts a flow: binds state, nonce and the PKCE verifier to this browser in a sealed httpOnly cookie. */
export async function beginGoogle(intent: GoogleIntent) {
  const g = googleLogin();
  if (!g) throw new GoogleAuthError("Google sign-in isn't configured.");
  const state = b64u(randomBytes(32)), nonce = b64u(randomBytes(32)), verifier = b64u(randomBytes(48));
  (await cookies()).set(FLOW_COOKIE, sealJson({ state, nonce, verifier, intent, exp: Date.now() + 600_000 }), cookieOpts(FLOW_PATH, 600));
  const q = new URLSearchParams({
    client_id: g.id, redirect_uri: g.redirect, response_type: "code", scope: "openid email profile",
    state, nonce, code_challenge: pkceChallenge(verifier), code_challenge_method: "S256", prompt: "select_account",
  });
  return `${AUTH_URL}?${q}`;
}

/** Reads and clears the flow cookie. Single use. */
export async function takeFlow() {
  const c = await cookies();
  const f = openJson<{ state: string; nonce: string; verifier: string; intent: GoogleIntent; exp: number }>(c.get(FLOW_COOKIE)?.value);
  c.set(FLOW_COOKIE, "", cookieOpts(FLOW_PATH, 0));
  return f && f.exp > Date.now() ? f : null;
}

export async function exchangeCode(code: string, verifier: string, env: Env = process.env) {
  const g = googleLogin(env);
  if (!g) throw new GoogleAuthError("Google sign-in isn't configured.");
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ code, client_id: g.id, client_secret: g.secret, redirect_uri: g.redirect, grant_type: "authorization_code", code_verifier: verifier }).toString(),
    signal: AbortSignal.timeout(15_000),
  });
  const j = (await r.json().catch(() => ({}))) as { id_token?: string; error?: string };
  if (!r.ok || !j.id_token) throw new GoogleAuthError(`token exchange failed: HTTP ${r.status}${j.error ? ` (${j.error})` : ""}`);
  return j.id_token;
}

// Google's signing keys, cached by kid for as long as Google's Cache-Control allows.
let jwks: { keys: Map<string, KeyObject>; exp: number; fetched: number } | null = null;
export const resetJwksCache = () => { jwks = null; };

async function signingKey(kid: string) {
  const now = Date.now();
  // An unknown kid means Google rotated keys; refetch, but at most once a minute.
  if (!jwks || jwks.exp < now || (!jwks.keys.has(kid) && now - jwks.fetched > 60_000)) {
    const r = await fetch(JWKS_URL, { signal: AbortSignal.timeout(10_000) });
    if (!r.ok) throw new GoogleAuthError(`couldn't fetch Google keys: HTTP ${r.status}`);
    const body = (await r.json()) as { keys?: (JsonWebKey & { kid?: string })[] };
    const maxAge = Number(/max-age=(\d+)/.exec(r.headers.get("cache-control") ?? "")?.[1] ?? 3600);
    const keys = new Map<string, KeyObject>();
    for (const k of body.keys ?? []) if (k.kid && k.kty === "RSA") keys.set(k.kid, createPublicKey({ key: k, format: "jwk" }));
    jwks = { keys, exp: now + Math.min(maxAge, 86400) * 1000, fetched: now };
  }
  const key = jwks.keys.get(kid);
  if (!key) throw new GoogleAuthError("ID token signed with an unknown key.");
  return key;
}

/** Verifies a Google ID token: RS256 signature against Google's keys, issuer, audience, expiry, nonce and verified email. */
export async function verifyIdToken(idToken: string, expect: { clientId: string; nonce: string }, now = Date.now()): Promise<GoogleClaims> {
  const parts = idToken.split(".");
  if (parts.length !== 3) throw new GoogleAuthError("Malformed ID token.");
  let header: { alg?: string; kid?: string }, p: Record<string, unknown>;
  try {
    header = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    p = JSON.parse(Buffer.from(parts[1], "base64url").toString());
  } catch { throw new GoogleAuthError("Malformed ID token."); }
  if (header.alg !== "RS256" || !header.kid) throw new GoogleAuthError("Unexpected ID token algorithm.");
  const key = await signingKey(header.kid);
  if (!verify("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], "base64url"))) throw new GoogleAuthError("Bad ID token signature.");
  const t = Math.floor(now / 1000);
  if (!ISSUERS.includes(String(p.iss))) throw new GoogleAuthError("Wrong issuer.");
  const aud = Array.isArray(p.aud) ? p.aud : [p.aud];
  if (!aud.includes(expect.clientId) || (aud.length > 1 && p.azp !== expect.clientId)) throw new GoogleAuthError("Wrong audience.");
  if (typeof p.exp !== "number" || p.exp + SKEW_S < t) throw new GoogleAuthError("ID token expired.");
  if (typeof p.iat === "number" && p.iat - SKEW_S > t) throw new GoogleAuthError("ID token issued in the future.");
  if (typeof p.nonce !== "string" || !safeEqual(p.nonce, expect.nonce)) throw new GoogleAuthError("Nonce mismatch.");
  if (p.email_verified !== true && p.email_verified !== "true") throw new GoogleAuthError("Google email not verified.");
  if (typeof p.sub !== "string" || !p.sub || typeof p.email !== "string") throw new GoogleAuthError("ID token missing subject or email.");
  return { sub: p.sub, email: p.email.toLowerCase(), name: typeof p.name === "string" ? p.name : null };
}

// A first Google sign-in that matches exactly one password account waits here until that password is entered.
type PendingLink = { sub: string; email: string; userId: string; exp: number };
export async function setPendingLink(v: Omit<PendingLink, "exp">) {
  (await cookies()).set(LINK_COOKIE, sealJson({ ...v, exp: Date.now() + 600_000 }), cookieOpts("/", 600));
}
export async function readPendingLink() {
  const v = openJson<PendingLink>((await cookies()).get(LINK_COOKIE)?.value);
  return v && v.exp > Date.now() ? v : null;
}
export async function clearPendingLink() { (await cookies()).set(LINK_COOKIE, "", cookieOpts("/", 0)); }
