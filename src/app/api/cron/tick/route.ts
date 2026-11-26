import { createHmac } from "node:crypto";
import { hostCronAllowed, same, tick } from "@/server/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** In-process scheduler of self-hosted installs (see instrumentation-node.ts): HMAC of the current minute. */
export async function POST(req: Request) {
  const [minute, sig] = (req.headers.get("x-medoro-cron") ?? "").split(".");
  const now = Math.floor(Date.now() / 60_000);
  const want = createHmac("sha256", process.env.SESSION_SECRET ?? "").update("cron:" + minute).digest("hex");
  if (!sig || !same(sig, want) || Math.abs(now - Number(minute)) > 2) return new Response("Forbidden", { status: 403 });
  return tick(false);
}

/** Host cron (Vercel Cron sends "Authorization: Bearer $CRON_SECRET"); runs the daily jobs. */
export async function GET(req: Request) {
  if (!hostCronAllowed(req)) return new Response("Forbidden", { status: 403 });
  return tick(true);
}
