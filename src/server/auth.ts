import "server-only";
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { hash as argonHash, verify as argonVerify } from "@node-rs/argon2";
import { cookies, headers } from "next/headers";
import { db } from "./db";

export const SESSION_COOKIE = "medoro_session";
export const TRUST_COOKIE = "medoro_trust";
const COUNTER_HOURS = 12;

const sha = (s: string) => createHash("sha256").update(s).digest("hex");
const secret = () => {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error("SESSION_SECRET must be set (32+ characters).");
  return s;
};

export const hashPassword = (pw: string) => argonHash(pw, { memoryCost: 19456, timeCost: 2, parallelism: 1 });
export const verifyPassword = (h: string | null | undefined, pw: string) => (h ? argonVerify(h, pw).catch(() => false) : Promise.resolve(false));

export async function clientInfo() {
  const h = await headers();
  return { ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip") ?? null, userAgent: h.get("user-agent") };
}

export async function createSession(userId: string, tokenVersion: number, opts: { device?: string; counterId?: string; mfaPassed: boolean }) {
  const token = randomBytes(32).toString("base64url");
  const { ip, userAgent } = await clientInfo();
  const expiresAt = new Date(Date.now() + COUNTER_HOURS * 3600_000);
  await db.session.create({
    data: { id: sha(token), userId, tokenVersion, device: opts.device ?? null, counterId: opts.counterId ?? null, mfaPassed: opts.mfaPassed, expiresAt, ip, userAgent },
  });
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires: expiresAt,
  });
}

/** The current session. MFA-pending sessions are returned only when `allowPendingMfa` is set. */
export async function readSession(allowPendingMfa = false) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const s = await db.session.findUnique({ where: { id: sha(token) }, include: { user: { include: { role: true, tenant: true } } } });
  if (!s || s.revokedAt || s.expiresAt < new Date() || !s.user.active || s.tokenVersion !== s.user.tokenVersion) return null;
  if (!s.mfaPassed && !allowPendingMfa) return null;
  if (Date.now() - s.lastSeenAt.getTime() > 60_000) {
    await db.session.update({ where: { id: s.id }, data: { lastSeenAt: new Date() } }).catch(() => {});
  }
  return s;
}

export async function markMfaPassed(sessionId: string) {
  await db.session.update({ where: { id: sessionId }, data: { mfaPassed: true } });
}

export async function destroySession() {
  const c = await cookies();
  const token = c.get(SESSION_COOKIE)?.value;
  if (token) await db.session.updateMany({ where: { id: sha(token) }, data: { revokedAt: new Date() } });
  c.delete(SESSION_COOKIE);
}

// "Trust this counter PC for 30 days": signed cookie bound to the user and their token version.
export async function setTrustedDevice(userId: string, tokenVersion: number) {
  const exp = Date.now() + 30 * 86400_000;
  const body = `${userId}.${tokenVersion}.${exp}`;
  const sig = createHmac("sha256", secret()).update(body).digest("base64url");
  (await cookies()).set(TRUST_COOKIE + "_" + userId.slice(0, 8), `${body}.${sig}`, {
    httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", expires: new Date(exp),
  });
}

export async function isTrustedDevice(userId: string, tokenVersion: number) {
  const v = (await cookies()).get(TRUST_COOKIE + "_" + userId.slice(0, 8))?.value;
  if (!v) return false;
  const i = v.lastIndexOf(".");
  const body = v.slice(0, i), sig = v.slice(i + 1);
  const want = createHmac("sha256", secret()).update(body).digest("base64url");
  if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return false;
  const [uid, tv, exp] = body.split(".");
  return uid === userId && Number(tv) === tokenVersion && Number(exp) > Date.now();
}

// ── Lockout: 5 failures → 15-minute cooldown per key (account and IP).
const MAX_FAILS = 5, LOCK_MIN = 15;

export async function checkLock(keys: string[]) {
  const rows = await db.loginAttempt.findMany({ where: { key: { in: keys } } });
  const locked = rows.find((r) => r.lockedUntil && r.lockedUntil > new Date());
  return locked ? Math.ceil((locked.lockedUntil!.getTime() - Date.now()) / 60_000) : 0;
}

export async function recordFailure(keys: string[]) {
  let left = MAX_FAILS;
  for (const key of keys) {
    const r = await db.loginAttempt.upsert({ where: { key }, create: { key, failures: 1 }, update: { failures: { increment: 1 } } });
    if (r.failures >= MAX_FAILS) await db.loginAttempt.update({ where: { key }, data: { failures: 0, lockedUntil: new Date(Date.now() + LOCK_MIN * 60_000) } });
    left = Math.min(left, MAX_FAILS - r.failures);
  }
  return Math.max(0, left);
}

export async function clearFailures(keys: string[]) {
  await db.loginAttempt.deleteMany({ where: { key: { in: keys } } });
}
