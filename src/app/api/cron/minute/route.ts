import { hostCronAllowed, tick } from "@/server/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Host cron every minute (Vercel Cron, Pro plan: "Authorization: Bearer $CRON_SECRET"). Runs the frequent jobs only, the
 * same as the self-hosted scheduler: Sales Pulse messages on time, deliveries, messaging. The daily jobs stay on /api/cron/tick.
 */
export async function GET(req: Request) {
  if (!hostCronAllowed(req)) return new Response("Forbidden", { status: 403 });
  return tick(false);
}
