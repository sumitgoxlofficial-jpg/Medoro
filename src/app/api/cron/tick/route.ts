import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { scheduledTick } from "@/domain/system/backup";
import { dailyJobs } from "@/domain/system/daily";

export const dynamic = "force-dynamic";
export const maxDuration = 300;
let running = false;

async function tick(daily: boolean) {
  if (running) return new Response("busy");
  running = true;
  try { await scheduledTick(new Date(), { daily }); await dailyJobs(); return new Response("ok"); }
  catch (e) { console.error("[scheduler]", e); return new Response("error", { status: 500 }); }
  finally { running = false; }
}

const same = (a: string, b: string) => timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());

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
  const secret = process.env.CRON_SECRET;
  if (!secret || secret.length < 16 || !same(req.headers.get("authorization") ?? "", `Bearer ${secret}`)) return new Response("Forbidden", { status: 403 });
  return tick(true);
}
