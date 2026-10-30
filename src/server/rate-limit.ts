import "server-only";
import { db } from "./db";

/**
 * Fixed-window counter for public endpoints (website forms, licence registration). Uses the
 * LoginAttempt table with an "rl:" key prefix; `lockedUntil` holds the end of the current window.
 * Returns false once `max` hits arrive within `windowMs`.
 */
export async function rateLimit(key: string, max: number, windowMs: number, now = new Date()) {
  const k = "rl:" + key;
  const end = new Date(now.getTime() + windowMs);
  const reset = await db.loginAttempt.updateMany({ where: { key: k, OR: [{ lockedUntil: null }, { lockedUntil: { lte: now } }] }, data: { failures: 1, lockedUntil: end } });
  if (reset.count) return true;
  const r = await db.loginAttempt.upsert({ where: { key: k }, create: { key: k, failures: 1, lockedUntil: end }, update: { failures: { increment: 1 } } });
  return r.failures <= max;
}
