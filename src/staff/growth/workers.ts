import "server-only";
import { db } from "@/server/db";
import { mailEnabled, sendMail } from "@/server/mail";
import { compose } from "@/server/mail-template";
import { log } from "@/server/log";
import { register, subscribe } from "./jobs";
import { processImport } from "./imports";
import { runDiscovery, type DiscoverInput } from "./discovery";
import { sendCampaignBatches } from "./comms";
import { escalateOverdue } from "./followups";
import { rollupDay } from "./analytics";
import { rescore } from "./leads";

// Job handlers (idempotent) and outbox subscribers. Imported lazily by jobs.ts.

register("import", async (p) => ((await processImport(String(p.jobId), 500)) ? "done" : "again"));
register("osm_discovery", async (p) => { await runDiscovery(p as { importJobId: string } & DiscoverInput); return "done"; });
register("campaign_send", async () => { await sendCampaignBatches(); return "done"; });
register("followup_escalation", async () => { await escalateOverdue(); return "done"; });
register("daily_rollup", async (p) => { await rollupDay(String(p.day)); return "done"; });
register("rescore_all", async (p) => {
  const after = String(p.after ?? "");
  const rows = await db.pharmacyLead.findMany({ where: { deletedAt: null, ...(after ? { id: { gt: after } } : {}) }, orderBy: { id: "asc" }, take: 500, select: { id: true } });
  for (const r of rows) await rescore(db, r.id);
  if (rows.length < 500) return "done";
  await db.backgroundJob.create({ data: { kind: "rescore_all", payload: { after: rows[rows.length - 1].id } } });
  return "done";
});

/** An escalated follow-up: tell the employee's team manager (and super admins when no manager), if email is set up. */
subscribe("followup.escalated", async (p) => {
  if (!mailEnabled()) return;
  const t = await db.followUpTask.findUnique({ where: { id: String(p.followUpId) }, include: { lead: { select: { code: true, name: true } }, staff: { select: { name: true, growthMember: { select: { team: { select: { managerId: true } } } } } } } });
  if (!t || t.status !== "open") return;
  const managerId = t.staff.growthMember?.team?.managerId;
  const to = managerId ? await db.staffUser.findMany({ where: { id: managerId, status: "active" }, select: { email: true } }) : await db.staffUser.findMany({ where: { role: "super_admin", status: "active" }, select: { email: true } });
  for (const r of to) {
    await sendMail({ to: r.email, ...(() => { const subject = `Overdue follow-up: ${t.lead.name}`; return { subject, ...compose({ greeting: "Hello,", blocks: [{ p: `A follow-up is overdue and still open.` }, { facts: [["Lead", `${t.lead.name} (${t.lead.code})`], ["Assigned to", t.staff.name], ["Was due", `${t.dueAt.toISOString().slice(0, 16).replace("T", " ")} UTC`]] }, { p: "Please open Growth Intelligence → Follow-up calendar to review or reassign it." }] }, subject) }; })() }).catch((e) => log.error("escalation mail failed", { err: e }));
  }
});
subscribe("lead.converted", async (p) => { log.info("growth conversion", { leadId: p.leadId, staffId: p.staffId }); });
subscribe("call.reported", async () => {});
subscribe("lead.stage", async () => {});
