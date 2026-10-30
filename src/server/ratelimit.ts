import "server-only";
import { db } from "./db";
import { UserError } from "./action";

export type Rule = { limit: number; windowSec: number; what: string };

/** Per-user (or per-IP) limits. Windows are fixed and aligned to the clock. */
export const RULES = {
  ai: { limit: 30, windowSec: 10 * 60, what: "AI questions" },
  waSend: { limit: 60, windowSec: 10 * 60, what: "WhatsApp messages sent by hand" },
  campaign: { limit: 5, windowSec: 60 * 60, what: "campaign starts" },
  fullExport: { limit: 3, windowSec: 60 * 60, what: "full data exports" },
  report: { limit: 60, windowSec: 10 * 60, what: "report downloads" },
  backupDownload: { limit: 10, windowSec: 60 * 60, what: "backup downloads" },
  document: { limit: 300, windowSec: 10 * 60, what: "document downloads" },
  otpSend: { limit: 5, windowSec: 15 * 60, what: "sign-in codes requested" },
  forgot: { limit: 5, windowSec: 60 * 60, what: "password reset requests" },
} as const satisfies Record<string, Rule>;
export type Bucket = keyof typeof RULES;

export class RateLimitError extends UserError {
  constructor(public retryAfterSec: number, what: string) {
    const mins = Math.ceil(retryAfterSec / 60);
    super(`Too many ${what}. Try again in ${mins <= 1 ? "a minute" : `${mins} minutes`}.`);
  }
}

export type RateResult = { ok: boolean; count: number; remaining: number; retryAfterSec: number };

/** Counts one hit for `subject` (e.g. tenantId:userId or an IP) in `bucket`. Atomic across app servers. */
export async function hit(bucket: Bucket | (Rule & { name: string }), subject: string, now = new Date()): Promise<RateResult> {
  const rule: Rule = typeof bucket === "string" ? RULES[bucket] : bucket;
  const name = typeof bucket === "string" ? bucket : bucket.name;
  const ms = rule.windowSec * 1000;
  const start = new Date(Math.floor(now.getTime() / ms) * ms);
  const key = `${name}:${subject}`;
  const [row] = await db.$queryRaw<{ count: number }[]>`
    INSERT INTO "RateLimit" ("key", "windowStart", "count") VALUES (${key}, ${start}, 1)
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimit"."windowStart" = EXCLUDED."windowStart" THEN "RateLimit"."count" + 1 ELSE 1 END,
      "windowStart" = EXCLUDED."windowStart"
    RETURNING "count"`;
  if (Math.random() < 0.01) db.$executeRaw`DELETE FROM "RateLimit" WHERE "windowStart" < ${new Date(now.getTime() - 86_400_000)}`.catch(() => {});
  const count = Number(row.count);
  return { ok: count <= rule.limit, count, remaining: Math.max(0, rule.limit - count), retryAfterSec: Math.max(1, Math.ceil((start.getTime() + ms - now.getTime()) / 1000)) };
}

/** Throws a RateLimitError (a UserError, so actions show its message) when over the limit. */
export async function enforce(bucket: Bucket, subject: string) {
  const r = await hit(bucket, subject);
  if (!r.ok) throw new RateLimitError(r.retryAfterSec, RULES[bucket].what);
}

/** For route handlers: a 429 response when over the limit, otherwise null. */
export async function limited(bucket: Bucket, subject: string): Promise<Response | null> {
  const r = await hit(bucket, subject);
  if (r.ok) return null;
  return new Response(new RateLimitError(r.retryAfterSec, RULES[bucket].what).message, { status: 429, headers: { "Retry-After": String(r.retryAfterSec), "Cache-Control": "no-store" } });
}

export const userKey = (ctx: { tenantId: string; userId: string }) => `${ctx.tenantId}:${ctx.userId}`;
