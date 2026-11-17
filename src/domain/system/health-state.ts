/**
 * Integration Health Centre: how an integration's state is derived.
 *
 * States, in the words the screen uses:
 *   not_configured  Nothing is set up (no credentials, no settings, nothing to monitor).
 *   connected       Set up, but no test has passed yet. Never shown as working.
 *   tested          A test genuinely passed, but there is no evidence yet of real use after it (or the test is stale).
 *   active          A test genuinely passed recently AND the integration has really done its job since (a delivered
 *                   message, a verified backup, a posted job…).
 *   error           The latest test or the latest real run failed.
 *
 * "active" is therefore only reachable through a passed test; it is derived on every read and never stored.
 */
export const HEALTH_STATES = ["not_configured", "connected", "tested", "active", "error"] as const;
export type HealthState = (typeof HEALTH_STATES)[number];

export const STATE_LABEL: Record<HealthState, string> = { not_configured: "Not configured", connected: "Connected", tested: "Tested", active: "Active", error: "Error" };

/** A test older than this no longer counts towards "active": the screen asks for a new one. */
export const TEST_TTL_MS = 24 * 3600_000;

export type Evidence = {
  /** Anything set up for this integration at all. */
  configured: boolean;
  /** Result of the most recent explicit test. "not_run" when nobody has tested it yet. */
  test: "pass" | "fail" | "not_run";
  testedAt?: Date | null;
  /** The latest real operation (not a test) failed. */
  runFailed?: boolean;
  /** The integration really did its job after the passing test, within its own freshness window. */
  inUse?: boolean;
  error?: string | null;
};

export function deriveState(e: Evidence, now = new Date()): HealthState {
  if (!e.configured) return "not_configured";
  if (e.test === "fail" || e.runFailed) return "error";
  if (e.test === "not_run" || !e.testedAt) return "connected";
  const fresh = now.getTime() - e.testedAt.getTime() <= TEST_TTL_MS;
  return fresh && e.inUse ? "active" : "tested";
}

/** A short reason a person can act on, matching the state. */
export function explain(state: HealthState, e: Evidence, now = new Date()): string {
  switch (state) {
    case "not_configured": return "Nothing is set up for this yet.";
    case "error": return e.error || "The last check failed.";
    case "connected": return "Set up, but no test has passed yet. Run a test.";
    case "tested": return e.testedAt && now.getTime() - e.testedAt.getTime() > TEST_TTL_MS ? "The last passing test is more than 24 hours old. Run a test again." : "A test passed. It becomes Active once it has done real work.";
    case "active": return "A recent test passed and it has done real work since.";
  }
}
