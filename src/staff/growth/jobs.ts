import "server-only";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { log } from "@/server/log";

/**
 * PostgreSQL-backed background jobs for Growth Intelligence. Workers claim with FOR UPDATE SKIP LOCKED, so several app
 * servers (or a cron and a "Run now" click) never run the same job twice. A failure retries with exponential backoff;
 * after maxAttempts the job is "dead" and shown to admins. Handlers must be idempotent: a crash after the work but before
 * "done" runs them again.
 */
export type JobKind = "import" | "osm_discovery" | "campaign_send" | "daily_rollup" | "followup_escalation" | "rescore_all";
type Handler = (payload: Record<string, unknown>, job: { id: string; attempts: number }) => Promise<"done" | "again">;

const handlers: Partial<Record<JobKind, Handler>> = {};
export function register(kind: JobKind, h: Handler) { handlers[kind] = h; }

export async function enqueue(kind: JobKind, payload: Prisma.InputJsonValue, opts: { key?: string; runAt?: Date; by?: string; maxAttempts?: number } = {}) {
  if (opts.key) {
    const existing = await db.backgroundJob.findUnique({ where: { idempotencyKey: opts.key } });
    if (existing) return existing;
  }
  return db.backgroundJob.create({ data: { kind, payload, idempotencyKey: opts.key ?? null, runAt: opts.runAt ?? new Date(), createdBy: opts.by ?? null, maxAttempts: opts.maxAttempts ?? 5 } }).catch(async (e) => {
    if (opts.key) { const r = await db.backgroundJob.findUnique({ where: { idempotencyKey: opts.key } }); if (r) return r; }
    throw e;
  });
}

export const backoffMs = (attempts: number) => Math.min(30_000 * 2 ** Math.max(0, attempts - 1), 6 * 3600_000);
const STALE_LOCK_MS = 10 * 60_000;

async function claim(now: Date) {
  const rows = await db.$queryRaw<{ id: string }[]>`
    UPDATE "BackgroundJob" SET "status" = 'running', "lockedAt" = ${now}, "attempts" = "attempts" + 1
    WHERE "id" = (
      SELECT "id" FROM "BackgroundJob"
      WHERE ("status" IN ('queued', 'failed') AND "runAt" <= ${now})
         OR ("status" = 'running' AND "lockedAt" < ${new Date(now.getTime() - STALE_LOCK_MS)})
      ORDER BY "runAt" ASC LIMIT 1 FOR UPDATE SKIP LOCKED
    ) RETURNING "id"`;
  return rows[0] ? db.backgroundJob.findUnique({ where: { id: rows[0].id } }) : null;
}

/** Runs due jobs until the time budget is spent. Returns how many ran. */
export async function runJobs(now = new Date(), budgetMs = 20_000): Promise<{ ran: number; failed: number }> {
  await import("./workers"); // registers handlers
  const until = Date.now() + budgetMs;
  let ran = 0, failed = 0;
  while (Date.now() < until) {
    const job = await claim(new Date(Math.max(now.getTime(), Date.now())));
    if (!job) break;
    ran++;
    const h = handlers[job.kind as JobKind];
    try {
      if (!h) throw new Error(`No handler for job kind ${job.kind}`);
      const r = await h(job.payload as Record<string, unknown>, job);
      if (r === "done") await db.backgroundJob.update({ where: { id: job.id }, data: { status: "done", finishedAt: new Date(), lockedAt: null, lastError: null } });
      // More work left (a chunked job): run again soon without counting it as a failed attempt.
      else await db.backgroundJob.update({ where: { id: job.id }, data: { status: "queued", lockedAt: null, attempts: { decrement: 1 }, runAt: new Date() } });
    } catch (e) {
      failed++;
      const dead = job.attempts >= job.maxAttempts;
      const msg = (e instanceof Error ? e.message : String(e)).slice(0, 500);
      await db.backgroundJob.update({ where: { id: job.id }, data: { status: dead ? "dead" : "failed", lockedAt: null, lastError: msg, runAt: new Date(Date.now() + backoffMs(job.attempts)) } });
      log.error("growth job failed", { kind: job.kind, id: job.id, attempts: job.attempts, dead, err: msg });
    }
  }
  return { ran, failed };
}

export async function retryJob(id: string) {
  const r = await db.backgroundJob.updateMany({ where: { id, status: { in: ["dead", "failed"] } }, data: { status: "queued", attempts: 0, runAt: new Date(), lastError: null } });
  return r.count > 0;
}

export async function jobList() {
  return db.backgroundJob.findMany({ orderBy: { createdAt: "desc" }, take: 50, select: { id: true, kind: true, status: true, attempts: true, maxAttempts: true, runAt: true, lastError: true, createdAt: true, finishedAt: true } });
}

// ── Outbox: domain events written in the same transaction as the change, dispatched here.
// Delivery is at-least-once (the scheduler runs one tick at a time per server); subscribers must be idempotent.
type OutboxHandler = (payload: Record<string, unknown>) => Promise<void>;
const subscribers: Record<string, OutboxHandler[]> = {};
export function subscribe(topic: string, h: OutboxHandler) { (subscribers[topic] ??= []).push(h); }

export async function dispatchOutbox(limit = 100) {
  await import("./workers");
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT "id" FROM "EventOutbox" WHERE "processedAt" IS NULL AND "attempts" < 8 ORDER BY "createdAt" LIMIT ${limit}`;
  let done = 0;
  for (const { id } of rows) {
    const ev = await db.eventOutbox.findUnique({ where: { id } });
    if (!ev || ev.processedAt) continue;
    try {
      for (const h of subscribers[ev.topic] ?? []) await h(ev.payload as Record<string, unknown>);
      await db.eventOutbox.update({ where: { id }, data: { processedAt: new Date(), attempts: { increment: 1 } } });
      done++;
    } catch (e) {
      await db.eventOutbox.update({ where: { id }, data: { attempts: { increment: 1 }, lastError: (e instanceof Error ? e.message : String(e)).slice(0, 500) } });
    }
  }
  return done;
}

/** Called by the app's scheduler (/api/cron/tick): schedules the daily jobs, runs what is due, dispatches events. */
export async function growthTick(now = new Date(), opts: { daily?: boolean } = {}) {
  const day = now.toISOString().slice(0, 10);
  await enqueue("followup_escalation", {}, { key: `escalation:${now.toISOString().slice(0, 13)}` });
  if (opts.daily || now.getUTCHours() === 21) await enqueue("daily_rollup", { day }, { key: `rollup:${day}` });
  await enqueue("campaign_send", {}, { key: `campaigns:${now.toISOString().slice(0, 15)}` }); // every ~10 minutes
  const r = await runJobs(now, 25_000);
  const events = await dispatchOutbox();
  return { ...r, events };
}
