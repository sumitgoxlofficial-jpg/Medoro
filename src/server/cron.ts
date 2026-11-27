import "server-only";
import { createHash, timingSafeEqual } from "node:crypto";
import { scheduledTick } from "@/domain/system/backup";
import { messagingTick } from "@/domain/comms/crm";
import { licenceTick } from "@/domain/system/licence";
import { log } from "@/server/log";
import { dailyJobs } from "@/domain/system/daily";
import { reportMailTick } from "@/domain/reports/mailer";
import { deliveryTick } from "@/domain/comms/delivery";
import { expirePoints } from "@/domain/sales/loyalty";
import { deletionTick } from "@/domain/system/deletion";
import { driveHealthTick } from "@/domain/system/drive-health";
import { autoDeleteMovedCopies } from "@/domain/system/drive-move";
import { growthTick } from "@/staff/growth/jobs";
import { leadSheetTick } from "@/staff/hrms/lead-sheet";
import { docExpiryTick } from "@/staff/hrms/docs";
import { escalationTick } from "@/staff/hrms/approvals";
import { workforceRetention } from "@/staff/hrms/workforce";
import { kpiTick } from "@/staff/hrms/kpi";
import { recordHeartbeat } from "@/domain/system/health";
import { chatBackupTick } from "@/staff/hrms/chat-backup";
import { salesPulseTick } from "@/staff/hrms/sales-pulse";
import { waTick } from "@/staff/hrms/whatsapp";


// The scheduled jobs, shared by the cron endpoints:
//  * POST /api/cron/tick: the in-process scheduler of self-hosted installs, every minute (frequent jobs only);
//  * GET /api/cron/tick: host cron (Vercel), once a day, with the daily jobs;
//  * GET /api/cron/minute: every minute from an outside scheduler (or Vercel Cron on Pro), frequent jobs only.
let running = false;

export async function tick(daily: boolean) {
  if (running) return new Response("busy");
  running = true;
  try {
    const now = new Date();
    let failed = false, firstError = "";
    // Each job runs even if another fails.
    for (const job of [() => scheduledTick(now, { daily }), () => deliveryTick(now), () => messagingTick(now, { daily }), () => licenceTick(), () => dailyJobs(now), () => reportMailTick(now, { daily }), () => expirePoints(now), () => deletionTick(now), () => driveHealthTick(now), () => autoDeleteMovedCopies(now), () => growthTick(now, { daily }), () => (daily ? leadSheetTick() : Promise.resolve()), () => docExpiryTick(), () => escalationTick(now), () => (daily ? workforceRetention(now) : Promise.resolve()), () => (daily ? kpiTick(now) : Promise.resolve()), () => (daily ? chatBackupTick(now) : Promise.resolve()), () => salesPulseTick(now, true), () => waTick(now)]) {
      try { await job(); } catch (e) { log.error("Scheduled job failed.", { err: e }); failed = true; firstError ||= e instanceof Error ? e.message : String(e); }
    }
    await recordHeartbeat(!failed, firstError).catch((e) => log.error("Heartbeat not recorded.", { err: e }));
    return failed ? new Response("error", { status: 500 }) : new Response("ok");
  }
  finally { running = false; }
}

export const same = (a: string, b: string) => timingSafeEqual(createHash("sha256").update(a).digest(), createHash("sha256").update(b).digest());


/** Host cron (Vercel Cron sends "Authorization: Bearer $CRON_SECRET"). */
export function hostCronAllowed(req: Request) {
  const secret = process.env.CRON_SECRET;
  return !!secret && secret.length >= 16 && same(req.headers.get("authorization") ?? "", `Bearer ${secret}`);
}
