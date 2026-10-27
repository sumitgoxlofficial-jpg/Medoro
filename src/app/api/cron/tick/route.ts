import { createHmac, timingSafeEqual } from "node:crypto";
import { scheduledTick } from "@/domain/system/backup";

let running = false;

export async function POST(req: Request) {
  const [minute, sig] = (req.headers.get("x-medoro-cron") ?? "").split(".");
  const now = Math.floor(Date.now() / 60_000);
  const want = createHmac("sha256", process.env.SESSION_SECRET ?? "").update("cron:" + minute).digest("hex");
  if (!sig || sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want)) || Math.abs(now - Number(minute)) > 2) return new Response("Forbidden", { status: 403 });
  if (running) return new Response("busy");
  running = true;
  try { await scheduledTick(); return new Response("ok"); }
  catch (e) { console.error("[scheduler]", e); return new Response("error", { status: 500 }); }
  finally { running = false; }
}
