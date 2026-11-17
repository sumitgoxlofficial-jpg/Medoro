import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorizeAny, authorizeView, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { dateOnly, isoOf, todayISO, addDays } from "@/lib/dates";
import { H1_SCHEDULES } from "@/lib/rx";
import { ALLOWED, MAX_BYTES, MAX_LABEL, saveDocument, sniff } from "@/server/storage";
import { RETENTION_RULES } from "./retention";
import { DEFAULT_REMIND_DAYS, INSPECTION_OUTCOMES, KINDS, SUGGESTED_REQUIRED, daysLeft, dueReminder, kindLabel, missingRequired, normalizeRemindDays, statusOf, type ItemStatus, type Required } from "./compliance-rules";

/**
 * Compliance centre. Everything here is record-keeping configured by the pharmacy; it does not state what the law requires
 * and it has not been reviewed by a regulatory professional. Writes need the stock-adjustment or user-management permission
 * and only reach branches the user can access. Items are never deleted, only switched off.
 */
const VIEW = ["adjust", "users", "reports"] as const;
const WRITE = ["adjust", "users"] as const;
const DOC_KINDS = ["licence_copy", "inspection_report", "other"] as const;

export type Settings = { required: Required[]; requiredIsDefault: boolean; retention: { label: string; years: number | null; note: string }[] };
export async function complianceSettings(tenantId: string): Promise<Settings> {
  const t = await db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true } });
  const c = (t.settings as { compliance?: { required?: Required[]; retention?: Settings["retention"] } } | null)?.compliance;
  return { required: c?.required ?? SUGGESTED_REQUIRED, requiredIsDefault: !c?.required, retention: c?.retention ?? [] };
}
const settingsSchema = z.object({
  required: z.array(z.object({ kind: z.enum(KINDS.map(([k]) => k) as [string, ...string[]]), scope: z.enum(["branch", "pharmacy"]) })).max(20),
  retention: z.array(z.object({ label: z.string().trim().min(3).max(120), years: z.number().int().min(0).max(100).nullable(), note: z.string().trim().max(300).default("") })).max(30),
});
export async function saveComplianceSettings(ctx: Ctx, raw: z.input<typeof settingsSchema>) {
  authorizeAny(ctx, "users");
  const s = settingsSchema.parse(raw);
  const t = await db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { settings: true } });
  await db.tenant.update({ where: { id: ctx.tenantId }, data: { settings: { ...((t.settings as object) ?? {}), compliance: s } } });
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Compliance settings changed", entity: "tenant", detail: `${s.required.length} required item(s), ${s.retention.length} retention rule(s)` });
}

const itemSchema = z.object({
  branchId: z.string().nullable(), kind: z.enum(KINDS.map(([k]) => k) as [string, ...string[]]), title: z.string().trim().min(3, "Give the item a title.").max(120),
  number: z.string().trim().max(80).optional(), holder: z.string().trim().max(120).optional(), authority: z.string().trim().max(120).optional(),
  issuedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(), expiresOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the expiry as a date.").nullable().optional(),
  notes: z.string().trim().max(500).optional(), remindDays: z.array(z.number()).optional(),
});

function branchOk(ctx: Ctx, branchId: string | null) {
  if (branchId && !ctx.branches.some((b) => b.id === branchId)) throw new UserError("You don’t have access to that branch.");
}
const canSee = (ctx: Ctx, branchId: string | null) => branchId === null || ctx.branches.some((b) => b.id === branchId);

export async function saveItem(ctx: Ctx, id: string | null, raw: z.input<typeof itemSchema>, version?: number) {
  authorizeAny(ctx, ...WRITE);
  const i = itemSchema.parse(raw);
  branchOk(ctx, i.branchId);
  if (i.issuedOn && i.expiresOn && i.expiresOn < i.issuedOn) throw new UserError("The expiry date is before the issue date.");
  const data = { branchId: i.branchId, kind: i.kind, title: i.title, number: i.number || null, holder: i.holder || null, authority: i.authority || null, issuedOn: i.issuedOn ? dateOnly(i.issuedOn) : null, expiresOn: i.expiresOn ? dateOnly(i.expiresOn) : null, notes: i.notes || null, remindDays: normalizeRemindDays(i.remindDays) };
  if (!id) {
    const c = await db.complianceItem.create({ data: { ...data, tenantId: ctx.tenantId, createdBy: ctx.userId } });
    await writeAudit(db, { tenantId: ctx.tenantId, branchId: i.branchId, userId: ctx.userId, userName: ctx.userName, action: "Compliance item added", entity: "compliance_item", entityId: c.id, detail: `${kindLabel(i.kind)} · ${i.title}${i.expiresOn ? ` · expires ${i.expiresOn}` : ""}` });
    return c.id;
  }
  const cur = await db.complianceItem.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!cur || !canSee(ctx, cur.branchId)) throw new UserError("Item not found.");
  const r = await db.complianceItem.updateMany({ where: { id, tenantId: ctx.tenantId, version: version ?? cur.version }, data: { ...data, version: { increment: 1 } } });
  if (!r.count) throw new UserError("Someone else changed this item. Reload and try again.");
  await writeAudit(db, { tenantId: ctx.tenantId, branchId: i.branchId, userId: ctx.userId, userName: ctx.userName, action: "Compliance item changed", entity: "compliance_item", entityId: id, detail: `${i.title} · expires ${i.expiresOn ?? "never"}${cur.expiresOn && i.expiresOn && isoOf(cur.expiresOn) !== i.expiresOn ? ` (was ${isoOf(cur.expiresOn)})` : ""}` });
  return id;
}

export async function setItemActive(ctx: Ctx, id: string, active: boolean) {
  authorizeAny(ctx, ...WRITE);
  const cur = await db.complianceItem.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!cur || !canSee(ctx, cur.branchId)) throw new UserError("Item not found.");
  await db.complianceItem.update({ where: { id }, data: { active, version: { increment: 1 } } });
  await writeAudit(db, { tenantId: ctx.tenantId, branchId: cur.branchId, userId: ctx.userId, userName: ctx.userName, action: active ? "Compliance item switched on" : "Compliance item switched off", entity: "compliance_item", entityId: id, detail: cur.title });
}

const inspectionSchema = z.object({
  branchId: z.string().min(1), inspectedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the inspection date."), authority: z.string().trim().min(2, "Enter who inspected.").max(120),
  inspector: z.string().trim().max(120).optional(), outcome: z.enum(INSPECTION_OUTCOMES.map(([k]) => k) as [string, ...string[]]),
  findings: z.string().trim().min(3, "Summarise the findings.").max(2000), actionDue: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
});
export async function addInspection(ctx: Ctx, raw: z.input<typeof inspectionSchema>) {
  authorizeAny(ctx, ...WRITE);
  const i = inspectionSchema.parse(raw);
  branchOk(ctx, i.branchId);
  if (i.inspectedOn > todayISO()) throw new UserError("The inspection date can’t be in the future.");
  if (i.actionDue && i.actionDue < i.inspectedOn) throw new UserError("The action date is before the inspection.");
  const c = await db.complianceInspection.create({ data: { tenantId: ctx.tenantId, branchId: i.branchId, inspectedOn: dateOnly(i.inspectedOn), authority: i.authority, inspector: i.inspector || null, outcome: i.outcome, findings: i.findings, actionDue: i.actionDue ? dateOnly(i.actionDue) : null, createdBy: ctx.userId } });
  await writeAudit(db, { tenantId: ctx.tenantId, branchId: i.branchId, userId: ctx.userId, userName: ctx.userName, action: "Inspection recorded", entity: "compliance_inspection", entityId: c.id, detail: `${i.authority} · ${i.outcome} · ${i.inspectedOn}` });
  return c.id;
}
export async function closeInspection(ctx: Ctx, id: string, note: string) {
  authorizeAny(ctx, ...WRITE);
  if (note.trim().length < 5) throw new UserError("Say what was done to close the findings.");
  const cur = await db.complianceInspection.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!cur || !canSee(ctx, cur.branchId)) throw new UserError("Inspection not found.");
  if (cur.actionsClosedOn) throw new UserError("Already closed.");
  await db.complianceInspection.update({ where: { id }, data: { actionsClosedOn: dateOnly(todayISO()), closingNote: note.trim().slice(0, 500) } });
  await writeAudit(db, { tenantId: ctx.tenantId, branchId: cur.branchId, userId: ctx.userId, userName: ctx.userName, action: "Inspection findings closed", entity: "compliance_inspection", entityId: id, detail: note.trim().slice(0, 200) });
}

/** Stores a scanned licence or report. The type comes from the file's own bytes; only PDF and common image types are accepted. */
export async function addDocument(ctx: Ctx, input: { itemId?: string | null; inspectionId?: string | null; kind: (typeof DOC_KINDS)[number]; title: string; fileName: string; bytes: Buffer }) {
  authorizeAny(ctx, ...WRITE);
  if (!DOC_KINDS.includes(input.kind)) throw new UserError("Choose what kind of document this is.");
  if (input.title.trim().length < 3) throw new UserError("Give the document a title.");
  if (!input.itemId && !input.inspectionId) throw new UserError("Attach the document to a licence or an inspection.");
  if (input.bytes.length === 0) throw new UserError("The file is empty.");
  if (input.bytes.length > MAX_BYTES) throw new UserError(`The file is larger than ${MAX_LABEL}.`);
  const mime = sniff(input.bytes);
  if (!mime) throw new UserError("Upload a PDF, JPG, PNG or WebP file.");
  if (input.itemId) { const it = await db.complianceItem.findFirst({ where: { id: input.itemId, tenantId: ctx.tenantId } }); if (!it || !canSee(ctx, it.branchId)) throw new UserError("Item not found."); }
  if (input.inspectionId) { const it = await db.complianceInspection.findFirst({ where: { id: input.inspectionId, tenantId: ctx.tenantId } }); if (!it || !canSee(ctx, it.branchId)) throw new UserError("Inspection not found."); }
  const saved = await saveDocument(ctx.tenantId, input.bytes, mime);
  const d = await db.complianceDocument.create({ data: { tenantId: ctx.tenantId, itemId: input.itemId ?? null, inspectionId: input.inspectionId ?? null, kind: input.kind, title: input.title.trim(), fileName: input.fileName.replace(/[^\w.\- ]/g, "_").slice(0, 120) || `file.${ALLOWED[mime]}`, storagePath: saved.rel, mime, sha256: saved.sha256, sizeBytes: input.bytes.length, createdBy: ctx.userId } });
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Compliance document stored", entity: "compliance_document", entityId: d.id, detail: `${input.title.trim()} · ${saved.sha256.slice(0, 12)} · ${saved.store}` });
  return d.id;
}
/** For the download route: the record only if the user may see its item or inspection. */
export async function documentFor(ctx: Ctx, id: string) {
  authorizeView(ctx, ...VIEW);
  const d = await db.complianceDocument.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!d) return null;
  const parent = d.itemId ? await db.complianceItem.findUnique({ where: { id: d.itemId }, select: { branchId: true } }) : d.inspectionId ? await db.complianceInspection.findUnique({ where: { id: d.inspectionId }, select: { branchId: true } }) : null;
  return parent && canSee(ctx, parent.branchId) ? d : null;
}

export type ItemRow = { id: string; branchId: string | null; branch: string; kind: string; kindLabel: string; title: string; number: string | null; holder: string | null; authority: string | null; issuedOn: string | null; expiresOn: string | null; daysLeft: number | null; status: ItemStatus; remindDays: number[]; active: boolean; notes: string | null; version: number; documents: { id: string; title: string; fileName: string }[] };
export type BranchStatus = { branchId: string; branch: string; level: "ok" | "attention" | "critical"; reasons: string[]; missing: string[]; h1: { lines: number; incomplete: number } };

/**
 * Sale lines of H1, X and narcotic medicines in the last 90 days that lack the prescriber, prescriber registration or patient.
 * Billing already refuses to create such a sale, so a gap here means an older, imported or offline-posted record. The Rx number
 * is not checked: Medoro does not require it at billing and does not claim it is mandatory.
 */
async function h1Completeness(tenantId: string, branchIds: string[], today: string) {
  const since = new Date(Date.parse(addDays(today, -90) + "T00:00:00Z"));
  const meds = (await db.medicine.findMany({ where: { tenantId, schedule: { in: [...H1_SCHEDULES] } }, select: { id: true } })).map((m) => m.id);
  const rows = !meds.length ? [] : await db.saleItem.findMany({
    where: { sale: { tenantId, branchId: { in: branchIds }, at: { gte: since }, voided: null }, medicineId: { in: meds }, qty: { gt: 0 } },
    select: { sale: { select: { branchId: true, prescriber: true, prescriberReg: true, patientName: true, customerId: true } } },
  });
  const by = new Map<string, { lines: number; incomplete: number }>();
  for (const r of rows) {
    const s = r.sale, x = by.get(s.branchId) ?? { lines: 0, incomplete: 0 };
    x.lines++;
    if (!s.prescriber?.trim() || !s.prescriberReg?.trim() || (!s.patientName?.trim() && !s.customerId)) x.incomplete++;
    by.set(s.branchId, x);
  }
  return by;
}

export async function complianceOverview(ctx: Ctx, now = new Date()) {
  authorizeView(ctx, ...VIEW);
  const today = todayISO(now), ids = ctx.branches.map((b) => b.id), names = new Map(ctx.branches.map((b) => [b.id, b.name]));
  const [settings, items, docs, inspections, h1] = await Promise.all([
    complianceSettings(ctx.tenantId),
    db.complianceItem.findMany({ where: { tenantId: ctx.tenantId, OR: [{ branchId: null }, { branchId: { in: ids } }] }, orderBy: [{ expiresOn: { sort: "asc", nulls: "last" } }, { title: "asc" }] }),
    db.complianceDocument.findMany({ where: { tenantId: ctx.tenantId, itemId: { not: null } }, select: { id: true, itemId: true, title: true, fileName: true } }),
    db.complianceInspection.findMany({ where: { tenantId: ctx.tenantId, branchId: { in: ids } }, orderBy: { inspectedOn: "desc" }, take: 50 }),
    h1Completeness(ctx.tenantId, ids, today),
  ]);
  const rows: ItemRow[] = items.map((c) => {
    const exp = c.expiresOn ? isoOf(c.expiresOn) : null;
    return { id: c.id, branchId: c.branchId, branch: c.branchId ? names.get(c.branchId) ?? "" : "Whole pharmacy", kind: c.kind, kindLabel: kindLabel(c.kind), title: c.title, number: c.number, holder: c.holder, authority: c.authority, issuedOn: c.issuedOn ? isoOf(c.issuedOn) : null, expiresOn: exp, daysLeft: exp ? daysLeft(exp, today) : null, status: statusOf(exp, today, c.remindDays), remindDays: c.remindDays, active: c.active, notes: c.notes, version: c.version, documents: docs.filter((d) => d.itemId === c.id).map((d) => ({ id: d.id, title: d.title, fileName: d.fileName })) };
  });
  const insp = inspections.map((i) => ({ id: i.id, branchId: i.branchId, branch: names.get(i.branchId) ?? "", inspectedOn: isoOf(i.inspectedOn), authority: i.authority, inspector: i.inspector, outcome: i.outcome, findings: i.findings, actionDue: i.actionDue ? isoOf(i.actionDue) : null, closedOn: i.actionsClosedOn ? isoOf(i.actionsClosedOn) : null, closingNote: i.closingNote, overdue: !i.actionsClosedOn && !!i.actionDue && isoOf(i.actionDue) < today, open: i.outcome !== "no_findings" && !i.actionsClosedOn }));
  const branches: BranchStatus[] = ctx.branches.map((b) => {
    const lite = rows.filter((r) => r.branchId === b.id || r.branchId === null).map((r) => ({ id: r.id, branchId: r.branchId, kind: r.kind, active: r.active, status: r.status }));
    const missing = missingRequired(b.id, lite, settings.required);
    const mine = rows.filter((r) => r.active && (r.branchId === b.id || r.branchId === null));
    const expired = mine.filter((r) => r.status === "expired"), expiring = mine.filter((r) => r.status === "expiring");
    const overdue = insp.filter((i) => i.branchId === b.id && i.overdue), open = insp.filter((i) => i.branchId === b.id && i.open);
    const x = h1.get(b.id) ?? { lines: 0, incomplete: 0 };
    const reasons: string[] = [];
    if (missing.length) reasons.push(`Missing: ${missing.map(kindLabel).join(", ")}`);
    if (expired.length) reasons.push(`Expired: ${expired.map((r) => r.title).join(", ")}`);
    if (expiring.length) reasons.push(`Expiring soon: ${expiring.map((r) => `${r.title} (${r.daysLeft} d)`).join(", ")}`);
    if (overdue.length) reasons.push(`${overdue.length} inspection finding(s) past their action date`);
    else if (open.length) reasons.push(`${open.length} inspection finding(s) open`);
    if (x.incomplete) reasons.push(`${x.incomplete} of ${x.lines} Schedule H1/X sale line(s) in the last 90 days lack the prescriber, prescriber registration or patient (older, imported or offline records)`);
    const level = missing.length || expired.length || overdue.length ? "critical" : reasons.length ? "attention" : "ok";
    return { branchId: b.id, branch: b.name, level, reasons, missing, h1: x };
  });
  return { settings, items: rows, inspections: insp, branches, retention: { configured: settings.retention, system: RETENTION_RULES.map((r) => ({ label: r.label, action: r.action })) }, kinds: KINDS, outcomes: INSPECTION_OUTCOMES, defaultRemind: [...DEFAULT_REMIND_DAYS] };
}

/** How many active items are expired or inside their reminder window: the badge and the alert line. */
export async function complianceCounts(tenantId: string, now = new Date()) {
  const today = todayISO(now);
  const items = await db.complianceItem.findMany({ where: { tenantId, active: true, expiresOn: { not: null } }, select: { expiresOn: true, remindDays: true } });
  let expired = 0, expiring = 0;
  for (const i of items) { const s = statusOf(isoOf(i.expiresOn!), today, i.remindDays); if (s === "expired") expired++; else if (s === "expiring") expiring++; }
  return { expired, expiring };
}

/**
 * Daily: for each active item with an expiry, sends the one due reminder to the report-email recipients and records it, so
 * it is never repeated and a renewed expiry date re-arms it. Without email set up, or with no recipients, the reminder is
 * still recorded as "not_emailed" (the in-app badge and alert show it) rather than pretending it was sent.
 */
export async function complianceReminders(tenantId: string, now = new Date()) {
  const today = todayISO(now);
  const [items, sent] = await Promise.all([
    db.complianceItem.findMany({ where: { tenantId, active: true, expiresOn: { not: null } } }),
    db.complianceReminder.findMany({ where: { tenantId }, select: { itemId: true, threshold: true, forExpiry: true } }),
  ]);
  const due = items.map((i) => ({ i, t: dueReminder(isoOf(i.expiresOn!), today, i.remindDays, sent.filter((s) => s.itemId === i.id && isoOf(s.forExpiry) === isoOf(i.expiresOn!)).map((s) => s.threshold)) })).filter((x): x is { i: (typeof items)[number]; t: number } => x.t != null);
  if (!due.length) return { due: 0, emailed: 0 };
  const { mailEnabled, sendMail } = await import("@/server/mail");
  const { reportMailSettings } = await import("@/domain/reports/mailer");
  const tenant = await db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { name: true } });
  const to = mailEnabled() ? (await reportMailSettings(tenantId)).recipients : [];
  let emailed = 0;
  for (const { i, t } of due) {
    const exp = isoOf(i.expiresOn!), d = daysLeft(exp, today);
    let outcome = "not_emailed", detail = mailEnabled() ? "No report-email recipients are set." : "Email isn’t set up on this server; the Compliance badge shows it.";
    if (to.length) {
      const text = `${tenant.name}: ${kindLabel(i.kind)} “${i.title}”${i.number ? ` (${i.number})` : ""} ${d < 0 ? `expired on ${exp}` : `expires on ${exp}, in ${d} day(s)`}.\n\nOpen Compliance in Medoro to update the renewal date once it is renewed. This is a reminder from your own records; Medoro does not check the licence with the authority.\n\nYou get this because you are on the report-email list of this pharmacy in Medoro.`;
      let ok = 0;
      for (const addr of to) { try { await sendMail({ to: addr, subject: `${d < 0 ? "Expired" : "Renewal due"}: ${i.title}`, text }); ok++; } catch { /* counted */ } }
      outcome = ok === to.length ? "emailed" : ok ? "partly_emailed" : "not_emailed"; detail = `${ok} of ${to.length} recipient(s)`; if (ok) emailed++;
    }
    await db.complianceReminder.create({ data: { tenantId, itemId: i.id, threshold: t, forExpiry: i.expiresOn!, outcome, detail } }).catch(() => undefined); // a parallel run already recorded it
  }
  return { due: due.length, emailed };
}
