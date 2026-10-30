// Pure scheduling rules for the daily backup. Times are India time (Asia/Kolkata).
const IST = 330 * 60_000;
export const STALE_RUNNING_MS = 30 * 60_000;
export const RETRY_GAP_MS = 30 * 60_000;
export const MAX_ATTEMPTS = 3;

export type Attempt = { status: string; startedAt: Date; finishedAt?: Date | null };
export type Decision =
  | { run: true; kind: "scheduled" | "retry" }
  | { run: false; reason: "before-time" | "done" | "running" | "gave-up" | "backoff" };

/** India-time clock: "HH:MM" and the UTC instant of today's local midnight. */
export function istClock(now: Date) {
  const ist = new Date(now.getTime() + IST).toISOString();
  return { hhmm: ist.slice(11, 16), dayStart: new Date(Date.parse(ist.slice(0, 10) + "T00:00:00Z") - IST) };
}

export const isStale = (a: Attempt, now: Date) => a.status === "running" && now.getTime() - a.startedAt.getTime() >= STALE_RUNNING_MS;

/**
 * Whether to start a scheduled backup now, given today's scheduled/retry attempts.
 * `daily`: the host cron fires once a day, so the chosen time and retry gap can't be honoured.
 */
export function backupDecision(now: Date, schedule: string, attempts: Attempt[], daily = false): Decision {
  if (!daily && istClock(now).hhmm < schedule) return { run: false, reason: "before-time" };
  const failed = attempts.filter((a) => a.status === "failed" || isStale(a, now));
  const live = attempts.filter((a) => !failed.includes(a));
  if (live.some((a) => a.status === "running")) return { run: false, reason: "running" };
  if (live.length) return { run: false, reason: "done" };
  if (failed.length >= MAX_ATTEMPTS) return { run: false, reason: "gave-up" };
  if (failed.length && !daily) {
    const last = Math.max(...failed.map((a) => (a.finishedAt ?? a.startedAt).getTime()));
    if (now.getTime() - last < RETRY_GAP_MS) return { run: false, reason: "backoff" };
  }
  return { run: true, kind: failed.length ? "retry" : "scheduled" };
}
