import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorize, authorizeView, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { mailEnabled, sendMail, type Attachment } from "@/server/mail";
import { toCsv } from "@/lib/csv-format";
import { addDays, dayMonth, istMidnight, todayISO } from "@/lib/dates";
import { inr0 } from "@/lib/money";
import { istClock } from "@/domain/system/schedule";
import { reportRows } from "@/domain/accounting/reports";
import type { Period } from "@/domain/accounting/service";
import { MAIL_REPORTS, WEEKDAYS, type MailReportId, type ReportMailLast as LastRun, type ReportMailSettings } from "./mail-contracts";

export { MAIL_REPORTS, WEEKDAYS };
export type { MailReportId, ReportMailSettings };

const DEFAULTS: ReportMailSettings = { enabled: false, frequency: "daily", weekday: 1, time: "08:00", recipients: [], reports: ["sales", "low-stock", "expiring"] };

export async function reportMailSettings(tenantId: string) {
  const t = await db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true } });
  const s = t.settings as { reportMail?: Partial<ReportMailSettings>; reportMailLast?: LastRun };
  return { ...DEFAULTS, ...(s.reportMail ?? {}), last: s.reportMailLast ?? null };
}

const settingsSchema = z.object({
  enabled: z.boolean(),
  frequency: z.enum(["daily", "weekly"]),
  weekday: z.number().int().min(0).max(6),
  time: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Pick a time like 08:00."),
  recipients: z.array(z.string().trim().toLowerCase().email("One of the email addresses looks wrong.")).max(10, "Up to 10 recipients."),
  reports: z.array(z.enum(MAIL_REPORTS.map((r) => r[0]) as [MailReportId, ...MailReportId[]])).max(MAIL_REPORTS.length),
});

export async function saveReportMail(ctx: Ctx, raw: z.input<typeof settingsSchema>) {
  authorize(ctx, "users");
  const s = settingsSchema.parse(raw);
  const v: ReportMailSettings = { ...s, recipients: [...new Set(s.recipients)], reports: [...new Set(s.reports)] };
  if (v.enabled && !v.recipients.length) throw new UserError("Add at least one email address.");
  if (v.enabled && !v.reports.length) throw new UserError("Choose at least one report.");
  await db.$executeRaw`UPDATE "Tenant" SET settings = jsonb_set(settings, '{reportMail}', ${JSON.stringify(v)}::jsonb) WHERE id = ${ctx.tenantId}`;
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Scheduled reports changed", entity: "tenant", detail: `${v.enabled ? "On" : "Off"} · ${v.frequency}${v.frequency === "weekly" ? " " + WEEKDAYS[v.weekday] : ""} ${v.time} · ${v.reports.join(", ") || "no reports"} · ${v.recipients.length} recipient${v.recipients.length === 1 ? "" : "s"}` });
  return v;
}

export async function reportMailView(ctx: Ctx) {
  authorizeView(ctx, "reports");
  return { ...(await reportMailSettings(ctx.tenantId)), mailReady: mailEnabled() };
}

/** Yesterday (daily) or the 7 days before today (weekly), as India-time calendar days. */
export function windowFor(frequency: ReportMailSettings["frequency"], now = new Date()): Period {
  const toDay = todayISO(now), fromDay = addDays(toDay, frequency === "daily" ? -1 : -7);
  const from = istMidnight(fromDay), to = istMidnight(toDay);
  const label = frequency === "daily" ? dayMonth(from, true) : `${dayMonth(from)} – ${dayMonth(new Date(to.getTime() - 1), true)}`;
  return { from, to, fromDay, toDay, label, key: fromDay };
}

const r2 = (p: number) => (p / 100).toFixed(2);

async function salesSummary(tenantId: string, branches: { id: string; name: string }[], p: Period) {
  const ids = branches.map((b) => b.id);
  const [sales, pays, rets, voids] = await Promise.all([
    db.$queryRaw<{ d: string; b: string; n: bigint; t: bigint }[]>`SELECT to_char((s.at + interval '330 minutes')::date, 'YYYY-MM-DD') d, s."branchId" b, COUNT(*) n, SUM(s."totalPaise") t FROM "Sale" s
      WHERE s."tenantId" = ${tenantId} AND s."branchId" = ANY(${ids}::text[]) AND s.at >= ${p.from} AND s.at < ${p.to} AND NOT EXISTS (SELECT 1 FROM "SaleVoid" v WHERE v."saleId" = s.id) GROUP BY 1, 2`,
    db.$queryRaw<{ d: string; b: string; m: string; t: bigint }[]>`SELECT to_char((s.at + interval '330 minutes')::date, 'YYYY-MM-DD') d, s."branchId" b, p.mode::text m, SUM(p."amountPaise") t FROM "Payment" p JOIN "Sale" s ON s.id = p."saleId"
      WHERE s."tenantId" = ${tenantId} AND s."branchId" = ANY(${ids}::text[]) AND s.at >= ${p.from} AND s.at < ${p.to} AND NOT EXISTS (SELECT 1 FROM "SaleVoid" v WHERE v."saleId" = s.id) GROUP BY 1, 2, 3`,
    db.$queryRaw<{ d: string; b: string; t: bigint }[]>`SELECT to_char((r.at + interval '330 minutes')::date, 'YYYY-MM-DD') d, r."branchId" b, SUM(r."amountPaise") t FROM "SalesReturn" r
      WHERE r."tenantId" = ${tenantId} AND r."branchId" = ANY(${ids}::text[]) AND r.at >= ${p.from} AND r.at < ${p.to} GROUP BY 1, 2`,
    db.$queryRaw<{ d: string; b: string; n: bigint }[]>`SELECT to_char((v.at + interval '330 minutes')::date, 'YYYY-MM-DD') d, v."branchId" b, COUNT(*) n FROM "SaleVoid" v
      WHERE v."tenantId" = ${tenantId} AND v."branchId" = ANY(${ids}::text[]) AND v.at >= ${p.from} AND v.at < ${p.to} GROUP BY 1, 2`,
  ]);
  const rows: (string | number)[][] = [["Date", "Branch", "Bills", "Gross sales", "Returns", "Net sales", "Cash", "UPI", "Card", "Credit", "Cash on delivery", "Voided bills"]];
  const totals = new Map<string, number>();
  for (let d = p.fromDay; d < p.toDay; d = addDays(d, 1)) {
    for (const b of branches) {
      const s = sales.find((x) => x.d === d && x.b === b.id), r = Number(rets.find((x) => x.d === d && x.b === b.id)?.t ?? 0);
      const pay = (m: string) => Number(pays.find((x) => x.d === d && x.b === b.id && x.m === m)?.t ?? 0);
      const gross = Number(s?.t ?? 0), vo = Number(voids.find((x) => x.d === d && x.b === b.id)?.n ?? 0);
      if (!gross && !r && !vo) continue;
      totals.set(b.name, (totals.get(b.name) ?? 0) + gross - r);
      rows.push([d, b.name, Number(s?.n ?? 0), r2(gross), r2(r), r2(gross - r), r2(pay("cash")), r2(pay("upi")), r2(pay("card")), r2(pay("credit")), r2(pay("cod")), vo]);
    }
  }
  const bills = sales.reduce((a, s) => a + Number(s.n), 0);
  return { rows, totals, bills };
}

/** The email for one run: a short summary in the body and one CSV per report. */
export async function buildReportMail(tenantId: string, s: Pick<ReportMailSettings, "frequency" | "reports">, now = new Date()) {
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  const branches = await db.branch.findMany({ where: { tenantId, active: true }, orderBy: { createdAt: "asc" } });
  if (!branches.length) throw new UserError("No active branches.");
  const p = windowFor(s.frequency, now);
  // Reports run for the whole pharmacy, as if the owner exported them for all branches.
  const ctx = { tenantId, tenantName: tenant.name, userId: "", userName: "Scheduler", userEmail: "", realRole: "Owner", role: "Owner", perms: ["reports"], branchId: branches[0].id, branchName: branches[0].name, branchCode: branches[0].code, branches: branches.map((b) => ({ id: b.id, name: b.name, code: b.code })), lang: "en", sessionId: "", counterId: null, counterName: null } satisfies Ctx;
  const attachments: Attachment[] = [], lines: string[] = [];
  const add = (name: string, rows: (string | number | null)[][]) => attachments.push({ filename: `${name}-${p.key}.csv`, content: toCsv(rows), contentType: "text/csv" });
  const sum = (rows: (string | number | null)[][], col: number) => rows.slice(1).reduce((a, r) => a + Math.max(0, Math.round(parseFloat(String(r[col] ?? 0)) * 100) || 0), 0);
  for (const id of s.reports) {
    if (id === "sales") {
      const x = await salesSummary(tenantId, branches, p);
      const net = [...x.totals.values()].reduce((a, b) => a + b, 0);
      lines.push(`Net sales: ${inr0(net)} from ${x.bills} bill${x.bills === 1 ? "" : "s"}`, ...branches.map((b) => `  ${b.name}: ${inr0(x.totals.get(b.name) ?? 0)}`));
      add("sales-summary", x.rows);
    } else if (id === "gst") {
      const rows = await reportRows(ctx, "gst-summary", p, "all");
      lines.push(`GST summary: ${rows.length - 1} slab${rows.length === 2 ? "" : "s"} (output and input tax)`);
      add("gst-summary", rows);
    } else if (id === "low-stock") {
      const rows = await reportRows(ctx, "low-stock", p, "all");
      lines.push(`Low stock: ${rows.length - 1} medicine${rows.length === 2 ? "" : "s"} below reorder level`);
      add("low-stock", rows);
    } else if (id === "expiring") {
      const rows = await reportRows(ctx, "expiry-exposure", p, "all");
      const col = rows[0]?.indexOf("Days left") ?? -1;
      const soon = col >= 0 ? rows.slice(1).filter((r) => Number(r[col]) <= 30).length : 0;
      lines.push(`Expiring: ${rows.length - 1} batch${rows.length === 2 ? "" : "es"} within 180 days, ${soon} within 30 days`);
      add("expiring-stock", rows);
    } else if (id === "dues") {
      const [c, sp] = await Promise.all([reportRows(ctx, "customer-dues", p), reportRows(ctx, "supplier-dues", p)]);
      lines.push(`Customer dues: ${inr0(sum(c, 2))} · Supplier dues: ${inr0(sum(sp, 2))}`);
      add("customer-dues", c); add("supplier-dues", sp);
    }
  }
  const title = `${s.frequency === "daily" ? "Daily" : "Weekly"} report · ${tenant.name} · ${p.label}`;
  return { subject: title, body: [title, "", ...lines, "", `Attached: ${attachments.map((a) => a.filename).join(", ")}`].join("\n"), attachments, period: p };
}

const SECRET = () => process.env.SESSION_SECRET ?? "";
export const unsubSig = (tenantId: string, email: string) => createHmac("sha256", SECRET()).update(`report-unsub:${tenantId}:${email.toLowerCase()}`).digest("base64url").slice(0, 32);
export function unsubLink(tenantId: string, email: string) {
  const base = process.env.APP_URL?.replace(/\/$/, "");
  return base ? `${base}/api/report-mail/unsubscribe?t=${encodeURIComponent(tenantId)}&e=${encodeURIComponent(email)}&s=${unsubSig(tenantId, email)}` : null;
}

/** Removes an address from the recipients. The link in each email is signed for that address only. */
export async function unsubscribe(tenantId: string, email: string, sig: string) {
  const want = unsubSig(tenantId, email);
  if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return false;
  return db.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<{ settings: { reportMail?: Partial<ReportMailSettings> } }[]>`SELECT settings FROM "Tenant" WHERE id = ${tenantId} FOR UPDATE`;
    if (!rows.length) return false;
    const cur = rows[0].settings.reportMail?.recipients ?? [];
    const next = cur.filter((r) => r.toLowerCase() !== email.toLowerCase());
    if (next.length !== cur.length) {
      await tx.$executeRaw`UPDATE "Tenant" SET settings = jsonb_set(settings, '{reportMail,recipients}', ${JSON.stringify(next)}::jsonb) WHERE id = ${tenantId}`;
      await writeAudit(tx, { tenantId, userName: email, action: "Scheduled report emails unsubscribed", entity: "tenant", detail: email });
    }
    return true;
  });
}

/** Sends this run's email to every recipient. Records the outcome on the settings and in the audit trail. */
export async function sendReportMail(tenantId: string, by: { userId?: string; userName?: string } = {}, now = new Date()) {
  const s = await reportMailSettings(tenantId);
  const done = async (ok: boolean, detail: string) => {
    const last: LastRun = { at: now.toISOString(), ok, detail };
    await db.$executeRaw`UPDATE "Tenant" SET settings = jsonb_set(settings, '{reportMailLast}', ${JSON.stringify(last)}::jsonb) WHERE id = ${tenantId}`;
    await writeAudit(db, { tenantId, userId: by.userId ?? null, userName: by.userName ?? "Scheduler", action: ok ? "Scheduled reports emailed" : "Scheduled reports failed", entity: "report_mail", detail });
    return last;
  };
  if (!s.recipients.length || !s.reports.length) return done(false, "No recipients or reports chosen.");
  if (!mailEnabled()) return done(false, "Email isn’t set up on this server (MAIL_PROVIDER).");
  const mail = await buildReportMail(tenantId, s, now);
  let sent = 0;
  const failed: string[] = [];
  for (const to of s.recipients) {
    const link = unsubLink(tenantId, to);
    const footer = `\n\nYou get this because ${to} is on the scheduled reports list of this pharmacy in Medoro.\n${link ? `Stop these emails: ${link}` : "To stop them, ask the owner to remove you under Owner view → Scheduled reports."}`;
    try { await sendMail({ to, subject: mail.subject, text: mail.body + footer, attachments: mail.attachments }); sent++; }
    catch { failed.push(to); }
  }
  const what = `${s.reports.join(", ")} · ${mail.period.label}`;
  return done(sent > 0, `${what} · sent to ${sent} of ${s.recipients.length}${failed.length ? ` · failed: ${failed.join(", ")}` : ""}`);
}

export async function sendReportsNow(ctx: Ctx) {
  authorize(ctx, "users");
  return sendReportMail(ctx.tenantId, ctx);
}

const weekdayIST = (now: Date) => new Date(now.getTime() + 330 * 60_000).getUTCDay();

/** Cron tick: each pharmacy's report goes once on its day, from its chosen time (India time). */
export async function reportMailTick(now = new Date(), opts: { daily?: boolean } = {}) {
  const tenants = await db.$queryRaw<{ id: string }[]>`SELECT id FROM "Tenant" WHERE settings->'reportMail'->>'enabled' = 'true'`;
  const { hhmm } = istClock(now);
  for (const t of tenants) {
    const s = await reportMailSettings(t.id);
    if (!opts.daily && hhmm < s.time) continue;
    if (s.frequency === "weekly" && weekdayIST(now) !== s.weekday) continue;
    const day = todayISO(now);
    // Claim today's run atomically so two servers or overlapping ticks can't both send.
    const claimed = await db.$executeRaw`UPDATE "Tenant" SET settings = jsonb_set(settings, '{reportMailRun}', to_jsonb(${day}::text)) WHERE id = ${t.id} AND COALESCE(settings->>'reportMailRun', '') <> ${day}`;
    if (claimed) await sendReportMail(t.id, {}, now).catch((e) => console.error("[report-mail]", e));
  }
}
