import "server-only";
import { db } from "@/server/db";
import { UserError } from "@/server/action";

const WINDOW_MS = 60_000;
export const aiRatePerMinute = () => Math.max(1, Number(process.env.AI_RATE_PER_MIN) || 30);

/**
 * Sliding one-minute window per user, in Postgres so every app instance shares it. The per-user
 * advisory lock makes count-then-insert atomic; rows older than the window are pruned on the way.
 */
export async function takeAiAsk(userId: string, now = new Date()) {
  const limit = aiRatePerMinute();
  const since = new Date(now.getTime() - WINDOW_MS);
  const ok = await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"ai-rate:" + userId}))`;
    await tx.aiAsk.deleteMany({ where: { userId, at: { lte: since } } });
    if ((await tx.aiAsk.count({ where: { userId } })) >= limit) return false;
    await tx.aiAsk.create({ data: { userId, at: now } });
    return true;
  });
  if (!ok) throw new UserError(`You’ve asked ${limit} questions in the last minute. Wait a moment and try again.`);
}
