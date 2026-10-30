// Startup checks, and the in-process scheduler for self-hosted installs (Node runtime only).
// On Vercel the daily jobs come from Vercel Cron instead (vercel.json).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { log } = await import("./server/log");
    try {
      const { checkEnv } = await import("./env-check");
      const problems = checkEnv();
      if (problems.length) {
        log.error("Configuration problems.", { problems });
        throw new Error("Medoro is not configured correctly.");
      }
      const { assertMigrationsApplied } = await import("./server/startup-check");
      await assertMigrationsApplied();
    } catch (e) {
      // Next.js keeps serving 500s after a failed instrumentation hook, so stop the process instead.
      log.error("Medoro will not start.", { reason: e instanceof Error ? e.message : String(e) });
      process.exit(1);
    }
  }
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.DISABLE_SCHEDULER !== "1" && !process.env.VERCEL) await import("./instrumentation-node");
}

/** Scrubbed crash reports, only when the owner opted in and strict mode is off (see domain/system/telemetry). */
export async function onRequestError(err: unknown, request: { path: string; method: string }, context: { routePath: string; routeType: string }) {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.CRASH_REPORT_URL) {
    const { reportCrash } = await import("./domain/system/telemetry");
    await reportCrash(err, { method: request.method, route: context.routePath, kind: context.routeType }).catch(() => {});
  }
}
