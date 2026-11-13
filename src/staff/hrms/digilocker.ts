import "server-only";
import { randomBytes, createHash, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { log } from "@/server/log";
import { seal, unsealClient } from "@/server/vault";
import { audit, type Me } from "./auth";
import { refreshKyc } from "./kyc";

// Aadhaar verification through the employee's own DigiLocker. The employee signs in to DigiLocker (Aadhaar OTP, done on
// DigiLocker's own pages: Medoro never sees the OTP), allows Medoro to read their e-Aadhaar, and Medoro checks that it
// belongs to the number they entered: the last four digits, their name and their date of birth. A match verifies the
// Aadhaar with no HR step. Medoro keeps nothing from DigiLocker: the e-Aadhaar is read once and dropped.
//
// Needs a DigiLocker partner (requester) account: set DIGILOCKER_CLIENT_ID, DIGILOCKER_CLIENT_SECRET and DIGILOCKER_BASE
// (the host DigiLocker gave you, e.g. https://api.digitallocker.gov.in), and register the redirect URI below with DigiLocker. Until then the employee uploads the Aadhaar card for HR instead.
type Env = Record<string, string | undefined>;
const FLOW_COOKIE = "medoro_hrdl", FLOW_PATH = "/staff/hrms/digilocker";

export function digilockerConfig(env: Env = process.env) {
  const id = env.DIGILOCKER_CLIENT_ID, secret = env.DIGILOCKER_CLIENT_SECRET;
  // The address is not guessed: DigiLocker gives each partner the host to use (production or sandbox) with the credentials.
  const base = (env.DIGILOCKER_BASE ?? "").trim().replace(/\/+$/, "");
  const redirect = env.DIGILOCKER_REDIRECT_URI || (env.APP_URL ? env.APP_URL.replace(/\/+$/, "") + "/staff/hrms/digilocker/callback" : "");
  return id && secret && base && redirect ? { id, secret, redirect, authorize: `${base}/public/oauth2/1/authorize`, token: `${base}/public/oauth2/1/token`, eaadhaar: `${base}/public/oauth2/3/xml/eaadhaar` } : null;
}
export const digilockerConfigured = () => !!digilockerConfig();

const b64u = (b: Buffer) => b.toString("base64url");
const equal = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const cookieOpts = (maxAge: number) => ({ httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: FLOW_PATH, maxAge });

// ── Reading and matching the e-Aadhaar (pure, so it is tested without DigiLocker)
export type EAadhaar = { last4: string; name: string; dob: string };
/** The masked number, name and date of birth from the e-Aadhaar XML (UidData uid="xxxxxxxx1234"; Poi name, dob). */
export function parseEAadhaar(xml: string): EAadhaar | null {
  const attr = (tag: string, name: string) => new RegExp(`<${tag}\\b[^>]*?\\b${name}="([^"]*)"`, "i").exec(xml)?.[1] ?? "";
  const uid = attr("UidData", "uid").replace(/\D/g, "");
  const name = attr("Poi", "name").trim();
  if (uid.length < 4 || !name) return null;
  return { last4: uid.slice(-4), name, dob: isoDob(attr("Poi", "dob")) };
}
/** dd-mm-yyyy, dd/mm/yyyy, ddmmyyyy or yyyy-mm-dd → yyyy-mm-dd ("" when it isn't a date). */
export function isoDob(raw: string) {
  const s = raw.trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (m) return s;
  m = /^(\d{2})[-/]?(\d{2})[-/]?(\d{4})$/.exec(s);
  return m ? `${m[3]}-${m[2]}-${m[1]}` : "";
}
const tokens = (n: string) => n.toLowerCase().replace(/[^a-z\s]/g, " ").split(/\s+/).filter((t) => t && !["mr", "mrs", "ms", "shri", "smt", "dr", "late"].includes(t));
/** Same person's name? Every word of the shorter name appears in the other, where one-letter initials match any word starting with them. */
export function namesMatch(a: string, b: string) {
  const [short, long] = [tokens(a), tokens(b)].sort((p, q) => p.length - q.length);
  const same = (t: string, u: string) => u === t || (t.length === 1 && u.startsWith(t)) || (u.length === 1 && t.startsWith(u));
  return short.length > 0 && short.every((t) => long.some((u) => same(t, u)));
}
/** Does this e-Aadhaar belong to the person who entered the number? Returns the reasons it does not. */
export function matchAadhaar(e: EAadhaar, mine: { last4: string; name: string; dob: string | null }) {
  const why: string[] = [];
  if (e.last4 !== mine.last4) why.push("The last four digits of the Aadhaar number you entered don’t match your DigiLocker Aadhaar.");
  if (!namesMatch(e.name, mine.name)) why.push("The name on your Aadhaar doesn’t match your name in Medoro.");
  if (mine.dob && e.dob && e.dob !== mine.dob) why.push("The date of birth on your Aadhaar doesn’t match the one in your profile.");
  return why;
}

// ── The sign-in with DigiLocker
/** Starts it: returns DigiLocker's sign-in URL. The Aadhaar number must be saved first (its last four digits are what is matched). */
export async function beginVerify(me: Me) {
  const c = digilockerConfig();
  if (!c) throw new UserError("DigiLocker isn’t set up on this server yet. Upload your Aadhaar card instead.");
  const p = await db.hrProfile.findUnique({ where: { staffId: me.id }, select: { aadhaarLast4: true } });
  if (!p?.aadhaarLast4) throw new UserError("Enter and save your Aadhaar number first.");
  const state = b64u(randomBytes(32)), verifier = b64u(randomBytes(48));
  (await cookies()).set(FLOW_COOKIE, b64u(seal(JSON.stringify({ state, verifier, staffId: me.id, exp: Date.now() + 600_000 }))), cookieOpts(600));
  const q = new URLSearchParams({ response_type: "code", client_id: c.id, redirect_uri: c.redirect, state, code_challenge: b64u(createHash("sha256").update(verifier).digest()), code_challenge_method: "S256" });
  return `${c.authorize}?${q}`;
}

async function takeFlow() {
  const jar = await cookies();
  const raw = jar.get(FLOW_COOKIE)?.value;
  jar.set(FLOW_COOKIE, "", cookieOpts(0));
  if (!raw) return null;
  try {
    const f = JSON.parse(unsealClient(Buffer.from(raw, "base64url")).toString()) as { state: string; verifier: string; staffId: string; exp: number };
    return f.exp > Date.now() ? f : null;
  } catch { return null; }
}

export type VerifyResult = { staffId: string; result: "verified" | "review"; why: string[] };
/**
 * DigiLocker's redirect lands here. Swaps the code for a token, reads the e-Aadhaar once, and matches it. A match
 * verifies the Aadhaar; a mismatch changes nothing (the employee uploads the card for HR). Nothing from DigiLocker is kept.
 */
export async function finishVerify(code: string, state: string): Promise<VerifyResult> {
  const c = digilockerConfig(), flow = await takeFlow();
  if (!c || !flow || !equal(flow.state, state)) throw new UserError("That DigiLocker sign-in expired. Try again.");
  if (!code) throw new UserError("DigiLocker didn’t send a sign-in code. Try again, or upload your Aadhaar card.");
  const staff = await db.staffUser.findFirst({ where: { id: flow.staffId, kind: "team", status: "active" }, select: { id: true, name: true, hr: { select: { aadhaarLast4: true, dob: true } } } });
  if (!staff?.hr?.aadhaarLast4) throw new UserError("Enter and save your Aadhaar number first.");
  const t = await fetch(c.token, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(15_000),
    body: new URLSearchParams({ grant_type: "authorization_code", code, client_id: c.id, client_secret: c.secret, redirect_uri: c.redirect, code_verifier: flow.verifier }) });
  const tj = (await t.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (!t.ok || !tj.access_token) { log.error("digilocker code exchange failed", { status: t.status, error: tj.error }); throw new UserError("DigiLocker didn’t accept the sign-in. Try again."); }
  const x = await fetch(c.eaadhaar, { headers: { authorization: `Bearer ${tj.access_token}` }, signal: AbortSignal.timeout(20_000) });
  if (!x.ok) { log.error("digilocker e-aadhaar read failed", { status: x.status }); throw new UserError("Couldn’t read your Aadhaar from DigiLocker. Make sure it is linked in your DigiLocker, or upload the card instead."); }
  const e = parseEAadhaar(await x.text());
  if (!e) throw new UserError("DigiLocker didn’t return an Aadhaar we can read. Upload the card instead.");
  const why = matchAadhaar(e, { last4: staff.hr.aadhaarLast4, name: staff.name, dob: staff.hr.dob ? staff.hr.dob.toISOString().slice(0, 10) : null });
  const me = { id: staff.id, name: staff.name };
  if (why.length) {
    await audit(me, "Aadhaar DigiLocker check did not match", why.length === 1 ? why[0] : `${why.length} differences`);
    return { staffId: staff.id, result: "review", why };
  }
  await db.hrProfile.update({ where: { staffId: staff.id }, data: { aadhaarVerifiedAt: new Date(), aadhaarVerifiedBy: "DigiLocker" } });
  await audit(me, "Aadhaar verified with DigiLocker", `XXXX XXXX ${e.last4}`);
  await refreshKyc(staff.id);
  return { staffId: staff.id, result: "verified", why: [] };
}
