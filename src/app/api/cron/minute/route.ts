import { hostCronAllowed, tick } from "@/server/cron";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Called every minute by an outside scheduler (Vercel Hobby allows only daily crons; see docs/VERCEL_SUPABASE.md) or by
 * Vercel Cron on Pro, with "Authorization: Bearer $CRON_SECRET". Runs the frequent jobs only, the same as the self-hosted
 * scheduler: Sales Pulse messages on time, deliveries, messaging. The daily jobs stay on /api/cron/tick.
 */
export async function GET(req: Request) {
  if (!hostCronAllowed(req)) return new Response("Forbidden", { status: 403 });
  return tick(false);
}
