// In-process scheduler for self-hosted installs (Node runtime only).
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs" && process.env.DISABLE_SCHEDULER !== "1") await import("./instrumentation-node");
}
