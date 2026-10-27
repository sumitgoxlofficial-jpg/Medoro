import { createHmac } from "crypto";

// Pings an internal, HMAC-signed endpoint once a minute so no server modules are pulled
// into the instrumentation bundle. The endpoint runs the daily backup check.
const g = globalThis as unknown as { medoroScheduler?: ReturnType<typeof setInterval> };
if (!g.medoroScheduler) {
  const port = process.env.PORT ?? "3000";
  g.medoroScheduler = setInterval(() => {
    const minute = Math.floor(Date.now() / 60_000).toString();
    const sig = createHmac("sha256", process.env.SESSION_SECRET ?? "").update("cron:" + minute).digest("hex");
    fetch(`http://127.0.0.1:${port}/api/cron/tick`, { method: "POST", headers: { "x-medoro-cron": `${minute}.${sig}` } }).catch(() => {});
  }, 60_000);
}
