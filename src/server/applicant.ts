import "server-only";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { seal, unsealClient } from "./vault";
import { safeEqual } from "./google-oidc";

// A job seeker on the public careers page who signed in with LinkedIn or Google. Nothing is stored in the
// database for them until they apply: their verified name and email live in a sealed httpOnly cookie for 7 days.
type Env = Record<string, string | undefined>;
export type ApplicantVia = "linkedin" | "google";
export type Applicant = { email: string; name: string; via: ApplicantVia; exp: number };

const APPLICANT_COOKIE = "medoro_applicant", LI_FLOW_COOKIE = "medoro_liflow";
const LI_FLOW_PATH = "/api/careers/linkedin";
const WEEK = 7 * 86400;
const cookieOpts = (path: string, maxAge: number) => ({ httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path, maxAge });
const sealJson = (v: unknown) => seal(JSON.stringify(v)).toString("base64url");
function openJson<T>(v: string | undefined): T | null {
  if (!v) return null;
  try { return JSON.parse(unsealClient(Buffer.from(v, "base64url")).toString()) as T; } catch { return null; }
}

/** Only a path inside /careers may be a return address (no open redirects). */
export const careersPath = (next: string | null | undefined) => (next && /^\/careers(\/[a-z0-9-]*)?(\?[\w=&%.-]*)?$/i.test(next) ? next : "/careers");

export async function setApplicant(a: Omit<Applicant, "exp">) {
  (await cookies()).set(APPLICANT_COOKIE, sealJson({ ...a, email: a.email.toLowerCase(), exp: Date.now() + WEEK * 1000 }), cookieOpts("/", WEEK));
}
export async function readApplicant(): Promise<Applicant | null> {
  const v = openJson<Applicant>((await cookies()).get(APPLICANT_COOKIE)?.value);
  return v && v.exp > Date.now() && v.email ? v : null;
}
export async function clearApplicant() { (await cookies()).set(APPLICANT_COOKIE, "", cookieOpts("/", 0)); }

// ── Sign In with LinkedIn using OpenID Connect (scopes openid profile email).
// Needs a LinkedIn app with the "Sign In with LinkedIn using OpenID Connect" product and this redirect URL added.
const LI_AUTH = "https://www.linkedin.com/oauth/v2/authorization";
const LI_TOKEN = "https://www.linkedin.com/oauth/v2/accessToken";
const LI_USERINFO = "https://api.linkedin.com/v2/userinfo";

export function linkedinLogin(env: Env = process.env) {
  const id = env.LINKEDIN_CLIENT_ID, secret = env.LINKEDIN_CLIENT_SECRET;
  const redirect = env.LINKEDIN_REDIRECT_URI || (env.APP_URL ? env.APP_URL.replace(/\/+$/, "") + "/api/careers/linkedin/callback" : "");
  return id && secret && redirect ? { id, secret, redirect } : null;
}

export async function beginLinkedin(next: string) {
  const li = linkedinLogin();
  if (!li) throw new Error("LinkedIn sign-in isn't configured.");
  const state = randomBytes(32).toString("base64url"), nonce = randomBytes(24).toString("base64url");
  (await cookies()).set(LI_FLOW_COOKIE, sealJson({ state, next: careersPath(next), exp: Date.now() + 600_000 }), cookieOpts(LI_FLOW_PATH, 600));
  const q = new URLSearchParams({ response_type: "code", client_id: li.id, redirect_uri: li.redirect, state, nonce, scope: "openid profile email" });
  return `${LI_AUTH}?${q}`;
}

/** Checks state, swaps the code for a token and reads the member's verified name and email. */
export async function finishLinkedin(url: URL): Promise<{ ok: true; next: string; email: string; name: string } | { ok: false; next: string; why: string }> {
  const c = await cookies();
  const flow = openJson<{ state: string; next: string; exp: number }>(c.get(LI_FLOW_COOKIE)?.value);
  c.set(LI_FLOW_COOKIE, "", cookieOpts(LI_FLOW_PATH, 0));
  const li = linkedinLogin();
  if (!flow || flow.exp < Date.now() || !safeEqual(flow.state, url.searchParams.get("state") ?? "")) return { ok: false, next: "/careers", why: "state" };
  const next = careersPath(flow.next);
  const code = url.searchParams.get("code");
  if (!li) return { ok: false, next, why: "off" };
  if (!code) return { ok: false, next, why: "cancelled" };
  try {
    const r = await fetch(LI_TOKEN, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: li.redirect, client_id: li.id, client_secret: li.secret }).toString(),
      signal: AbortSignal.timeout(15_000),
    });
    const tok = (await r.json().catch(() => ({}))) as { access_token?: string; error?: string };
    if (!r.ok || !tok.access_token) throw new Error(`token exchange failed: HTTP ${r.status}${tok.error ? ` (${tok.error})` : ""}`);
    const u = await fetch(LI_USERINFO, { headers: { Authorization: `Bearer ${tok.access_token}` }, signal: AbortSignal.timeout(10_000) });
    const p = (await u.json().catch(() => ({}))) as { email?: string; email_verified?: boolean | string; name?: string; given_name?: string; family_name?: string };
    if (!u.ok || !p.email) throw new Error(`userinfo failed: HTTP ${u.status}`);
    if (p.email_verified === false || p.email_verified === "false") return { ok: false, next, why: "unverified" };
    const name = (p.name || [p.given_name, p.family_name].filter(Boolean).join(" ")).trim();
    return { ok: true, next, email: p.email.toLowerCase(), name };
  } catch (e) {
    console.error(`[linkedin] sign-in failed: ${e instanceof Error ? e.message : "unknown error"}`);
    return { ok: false, next, why: "error" };
  }
}
