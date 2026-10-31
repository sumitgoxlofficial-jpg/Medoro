import { addDays, daysTo, istDate, todayISO } from "@/lib/dates";

export const TRIAL_DAYS = 7;
export const GRACE_DAYS = 7;

export type SubscriptionInput = {
  status: string; // trial, active, grace, cancelled — as issued by the licence server (or the local trial)
  /** Trial end or paid-until. */
  endsAt: Date | null;
  graceDays: number;
  /** A licence document signed by the licence server has been received. */
  signed: boolean;
  /** LICENSE_SERVER_URL is set. */
  serverConfigured: boolean;
};

export type Phase = "unlicensed" | "trial" | "active" | "grace" | "expired";

export type Access = {
  phase: Phase;
  readOnly: boolean;
  /** Last day of the trial or paid period (IST calendar date). */
  endsOn: string | null;
  /** Last day of the grace period. */
  graceEndsOn: string | null;
  /** Days left in the current phase (0 on its last day). */
  daysLeft: number | null;
  cancelled: boolean;
  trial: boolean;
};

/**
 * Where a pharmacy is in its subscription. Trial or paid period → grace (`graceDays` after the end date)
 * → read-only. A cancelled plan runs to the end of what was paid, then goes read-only without grace. A pure
 * self-hosted install (no licence server configured and no signed licence ever received) is never limited.
 */
export function subscriptionAccess(i: SubscriptionInput, now = new Date()): Access {
  const cancelled = i.status === "cancelled", trial = i.status === "trial";
  if (!i.signed && !i.serverConfigured) return { phase: "unlicensed", readOnly: false, endsOn: null, graceEndsOn: null, daysLeft: null, cancelled: false, trial: false };
  if (!i.endsAt) return { phase: cancelled ? "expired" : i.status === "trial" ? "trial" : "active", readOnly: cancelled, endsOn: null, graceEndsOn: null, daysLeft: null, cancelled, trial };
  const today = todayISO(now);
  const endsOn = istDate(i.endsAt);
  const grace = cancelled ? 0 : Math.max(0, i.graceDays);
  const graceEndsOn = addDays(endsOn, grace);
  const left = daysTo(endsOn, today);
  if (left >= 0) return { phase: trial ? "trial" : "active", readOnly: false, endsOn, graceEndsOn: grace ? graceEndsOn : null, daysLeft: left, cancelled, trial };
  const graceLeft = daysTo(graceEndsOn, today);
  if (graceLeft >= 0) return { phase: "grace", readOnly: false, endsOn, graceEndsOn, daysLeft: graceLeft, cancelled, trial };
  return { phase: "expired", readOnly: true, endsOn, graceEndsOn: grace ? graceEndsOn : null, daysLeft: 0, cancelled, trial };
}

/** The banner text the app shell shows, or null when there's nothing to say. */
export function subscriptionBanner(a: Access): { tone: "amber" | "red"; text: string } | null {
  const days = (n: number) => `${n} day${n === 1 ? "" : "s"}`;
  if (a.phase === "expired") return { tone: "red", text: "Subscription expired — renew. Sales, purchases, stock changes and messages are paused; viewing, exports and backups still work." };
  if (a.phase === "grace") return { tone: "amber", text: `${a.trial ? "Free trial" : "Your plan"} has ended. ${a.daysLeft ? `${days(a.daysLeft)} left` : "Last day"} before Medoro becomes read-only — renew from Plan.` };
  if (a.phase === "trial" && a.daysLeft !== null && a.daysLeft <= 3) return { tone: "amber", text: `Free trial ends ${a.daysLeft ? `in ${days(a.daysLeft)}` : "today"}. Renew from Plan to keep billing.` };
  if (a.cancelled && a.daysLeft !== null && a.daysLeft <= 7) return { tone: "amber", text: `Plan cancelled. Medoro becomes read-only ${a.daysLeft ? `in ${days(a.daysLeft)}` : "after today"}.` };
  return null;
}
