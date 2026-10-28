// Startup checks, and the in-process scheduler for self-hosted installs (Node runtime only).
// On Vercel the daily jobs come from Vercel Cron instead (vercel.json).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.NODE_ENV === "production" && process.env.NEXT_PHASE !== "phase-production-build") {
    const { checkEnv } = await import("./env-check");
    const problems = checkEnv();
    if (problems.length) {
      console.error("[medoro] Configuration problems:\n - " + problems.join("\n - "));
      throw new Error("Medoro is not configured correctly. See the server log.");
    }
  }
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.DISABLE_SCHEDULER !== "1" && !process.env.VERCEL) await import("./instrumentation-node");
}
