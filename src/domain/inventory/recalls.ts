import "server-only";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorize, authorizeAny, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { nextSeq, pad } from "@/server/sequence";
import { dateOnly, daysTo, isoOf } from "@/lib/dates";
import { returnToSupplierIn } from "./adjust";
import { recallMatches, batchKey } from "./recall-match";

export const RECALL_STATUS = ["open", "investigating", "supplier_return", "resolved"] as const;
export const recallSchema = z.object({
  medicineId: z.string().optional(), batches: z.string().trim().min(1, "Enter the affected batch numbers."),
  source: z.string().trim().min(3, "Enter where the notice came from."), publishedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the publication date."),
  reason: z.string().trim().max(200).default(""),
  // Optional notice details; a notice that names a manufacturer and product instead of one catalogue medicine needs both.
  manufacturer: z.string().trim().max(120).optional(), product: z.string().trim().max(160).optional(),
  noticeNo: z.string().trim().max(80).optional(), sourceUrl: z.string().trim().max(500).optional(),
}).superRefine((v, c) => {
  const id = (v.medicineId ?? "").trim();
  if (!id && !(v.manufacturer && v.product)) c.addIssue({ code: "custom", path: ["medicineId"], message: "Choose the medicine from your catalogue, or enter the manufacturer and product." });
  if (id && !/^[0-9a-f-]{36}$/i.test(id)) c.addIssue({ code: "custom", path: ["medicineId"], message: "Choose the medicine from your catalogue." });
  if (v.sourceUrl && !/^https:\/\/[^\s]+$/i.test(v.sourceUrl)) c.addIssue({ code: "custom", path: ["sourceUrl"], message: "The notice link must start with https://." });
});

/** Recall behaviour of this pharmacy. Quarantine on recording is on unless the owner turns it off. */
export async function recallSettings(tenantId: string) {
  const t = await db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true } });
  return { autoQuarantine: ((t.settings as { recall?: { autoQuarantine?: boolean } } | null)?.recall?.autoQuarantine) !== false };
}
export async function saveRecallSettings(ctx: Ctx, patch: { autoQuarantine: boolean }) {
  authorize(ctx, "users");
  const t = await db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { settings: true } });
  await db.tenant.update({ where: { id: ctx.tenantId }, data: { settings: { ...((t.settings as object) ?? {}), recall: { autoQuarantine: !!patch.autoQuarantine } } } });
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Recall settings changed", entity: "tenant", detail: `Quarantine on recording: ${patch.autoQuarantine ? "on" : "off"}` });
}

type RecallRow = { medicineId: string | null; manufacturer: string | null; product: string; batchNos: string[] };
/** Batches a notice affects (see recall-match.ts), narrowed further by `where`. */
export async function affectedBatches<T extends Prisma.BatchWhereInput>(client: Prisma.TransactionClient | typeof db, tenantId: string, r: RecallRow, where?: T) {
  const bs = await client.batch.findMany({ where: { tenantId, batchNo: { in: r.batchNos.map(batchKey) }, ...(where ?? {}) }, include: { medicine: { select: { name: true, generic: true, manufacturer: true, packSize: true } } } });
  return bs.filter((b) => recallMatches(r, b));
}

export async function listRecalls(ctx: Ctx) {
  const recalls = await db.recall.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: "desc" } });
  const allNos = [...new Set(recalls.flatMap((r) => r.batchNos.map(batchKey)))];
  const batches = allNos.length ? await db.batch.findMany({ where: { tenantId: ctx.tenantId, batchNo: { in: allNos } }, include: { medicine: { select: { name: true, generic: true, manufacturer: true } } } }) : [];
  const branches = await db.branch.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } });
  return recalls.map((r) => ({
    id: r.id, ref: r.sourceRef, product: r.product, source: r.source, publishedAt: isoOf(r.publishedAt), reason: r.reason, status: r.status, batchNos: r.batchNos,
    matches: batches.filter((b) => recallMatches(r, b)).map((b) => ({ id: b.id, medicine: b.medicine.name, batchNo: b.batchNo, branch: branches.find((x) => x.id === b.branchId)?.name ?? "", here: b.branchId === ctx.branchId, returnable: b.branchId === ctx.branchId && !!b.supplierId && b.qtyAvailable > 0, qty: b.qtyAvailable, status: b.status, sellable: b.status === "ok" && b.qtyAvailable > 0 && daysTo(b.expiryDate) > 0 })),
  }));
}

/** Blocks every sellable batch that a notice affects, in the given branches. Quarantine is reversible stock control, not a write-off. */
async function quarantineIn(tx: Prisma.TransactionClient, ctx: Ctx, r: RecallRow & { id: string; sourceRef: string }, branchIds: string[]) {
  const bs = await affectedBatches(tx, ctx.tenantId, r, { status: "ok", branchId: { in: branchIds } });
  for (const b of bs) {
    await tx.batch.update({ where: { id: b.id }, data: { status: "quarantine", statusNote: `Recall ${r.sourceRef}`, version: { increment: 1 } } });
    await tx.stockMovement.create({ data: { tenantId: ctx.tenantId, branchId: b.branchId, batchId: b.id, qty: 0, type: "quarantine", refType: "recall", refId: r.id, userId: ctx.userId, note: `Recall ${r.sourceRef}` } });
  }
  return bs.length;
}

export async function addRecall(ctx: Ctx, raw: z.input<typeof recallSchema>) {
  authorizeAny(ctx, "adjust", "users");
  const i = recallSchema.parse(raw);
  const nos = [...new Set(i.batches.toUpperCase().split(/[\s,;]+/).filter(Boolean))];
  if (daysTo(i.publishedAt) > 0) throw new UserError("Publication date can’t be in the future.");
  const auto = (await recallSettings(ctx.tenantId)).autoQuarantine;
  let blocked = 0, id = "";
  const ref = await db.$transaction(async (tx) => {
    let medicineId: string | null = null, product = (i.product ?? "").trim();
    if (i.medicineId) {
      const m = await tx.medicine.findFirst({ where: { id: i.medicineId, tenantId: ctx.tenantId } });
      if (!m) throw new UserError("Medicine not found.");
      medicineId = m.id; product = `${m.name} ${m.strength}`.trim();
    }
    const ref = `RC-${pad(await nextSeq(tx, ctx.tenantId, "RC"))}`;
    const r = await tx.recall.create({ data: {
      tenantId: ctx.tenantId, source: i.source, sourceRef: ref, publishedAt: dateOnly(i.publishedAt), product, medicineId, batchNos: nos, reason: i.reason || "Not specified", status: "open", createdBy: ctx.userId,
      manufacturer: medicineId ? null : (i.manufacturer ?? null), noticeNo: i.noticeNo || null, sourceUrl: i.sourceUrl || null, verifiedBy: ctx.userId, verifiedAt: new Date(),
    } });
    await writeAudit(tx, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: `Recall notice recorded ${ref}`, entity: "recall", entityId: r.id, detail: `${product} · ${nos.join(", ")} · source: ${i.source}${i.noticeNo ? ` · notice ${i.noticeNo}` : ""}` });
    // Stock of the affected batches is blocked at once in EVERY branch, not only the user's: a recall is a pharmacy-wide hazard, and quarantine is reversible.
    if (auto) {
      const branchIds = (await tx.branch.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true } })).map((b) => b.id);
      const n = await quarantineIn(tx, ctx, r, branchIds);
      blocked = n;
      if (n) {
        await tx.recall.update({ where: { id: r.id }, data: { status: "investigating" } });
        await writeAudit(tx, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: `Recall auto-quarantine ${ref}`, entity: "recall", entityId: r.id, detail: `${n} batch(es) blocked in all branches on recording` });
      }
    }
    id = r.id;
    return ref;
  });
  await notifyRecall(ctx, id, ref, blocked);
  return ref;
}

/**
 * Tells the people the owner chose for report emails that a notice was recorded. Best effort and honest: the outcome,
 * including "email isn't set up", goes in the audit trail; the in-app alert (open recalls badge) works regardless.
 */
async function notifyRecall(ctx: Ctx, id: string, ref: string, blocked: number) {
  let detail: string;
  try {
    const { mailEnabled, sendMail } = await import("@/server/mail");
    const { reportMailSettings } = await import("@/domain/reports/mailer");
    const to = (await reportMailSettings(ctx.tenantId)).recipients;
    if (!mailEnabled()) detail = "Not emailed: email isn’t set up on this server. The Recalls badge shows it.";
    else if (!to.length) detail = "Not emailed: no report-email recipients are set.";
    else {
      const rec = await db.recall.findUniqueOrThrow({ where: { id } });
      const text = `A recall notice was recorded for ${ctx.tenantName}.\n\nProduct: ${rec.product}\nBatches: ${rec.batchNos.join(", ")}\nSource: ${rec.source}${rec.noticeNo ? ` (notice ${rec.noticeNo})` : ""}\nReason: ${rec.reason}\n\n${blocked ? `${blocked} batch(es) were blocked from sale in all branches.` : "No sellable stock matched, or quarantine on recording is off."}\n\nReview it under Recalls & alerts in Medoro.` + "\n\nYou get this because you are on the report-email list of this pharmacy in Medoro.";
      let sent = 0;
      for (const addr of to) { try { await sendMail({ to: addr, subject: `Recall notice ${ref}: ${rec.product}`, text }); sent++; } catch { /* counted below */ } }
      if (sent < to.length) throw new Error(`${to.length - sent} of ${to.length} emails failed`);
      detail = `Emailed ${sent} recipient(s).`;
    }
  } catch (e) { detail = `Notification failed: ${(e instanceof Error ? e.message : String(e)).slice(0, 120)}`; }
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: `Recall notification ${ref}`, entity: "recall", entityId: id, detail });
}

/** Quarantines every sellable matching batch in branches the user can access. */
export async function quarantineRecall(ctx: Ctx, id: string) {
  authorize(ctx, "adjust");
  return db.$transaction(async (tx) => {
    const r = await tx.recall.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!r) throw new UserError("Recall not found.");
    const n = await quarantineIn(tx, ctx, r, ctx.branches.map((b) => b.id));
    if (r.status === "open") await tx.recall.update({ where: { id }, data: { status: "investigating" } });
    await writeAudit(tx, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: `Recall quarantine ${r.sourceRef}`, entity: "recall", entityId: id, detail: `${n} batch(es) blocked` });
    return n;
  });
}

/**
 * Changes a notice's status. "Resolved" is refused while any affected stock is still held in any branch, unless the
 * user records why it remains (`note`); the closing time, user and note are kept and audited.
 */
export async function setRecallStatus(ctx: Ctx, id: string, status: (typeof RECALL_STATUS)[number], note?: string) {
  authorizeAny(ctx, "adjust", "users");
  if (!RECALL_STATUS.includes(status)) throw new UserError("Unknown status.");
  const found = await db.recall.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!found) throw new UserError("Recall not found.");
  if (status === "supplier_return") {
    const here = await affectedBatches(db, ctx.tenantId, found, { branchId: ctx.branchId, qtyAvailable: { gt: 0 }, supplierId: { not: null } });
    if (here.length) { await returnRecalled(ctx, id); return; }
  }
  let resolution: { resolvedAt: Date; resolutionNote: string | null } | null = null;
  if (status === "resolved") {
    const left = await affectedBatches(db, ctx.tenantId, found, { qtyAvailable: { gt: 0 } });
    const units = left.reduce((a, b) => a + b.qtyAvailable, 0), why = (note ?? "").trim();
    if (left.length && why.length < 5) throw new UserError(`${units} unit(s) of the recalled batches are still held (${left.map((b) => b.batchNo).join(", ")}). Return or dispose of them first, or record why they remain.`);
    resolution = { resolvedAt: new Date(), resolutionNote: left.length ? `Closed with ${units} unit(s) still held: ${why}` : (why || null) };
  }
  await db.recall.update({ where: { id }, data: { status, ...(resolution ?? { resolvedAt: null }) } });
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Recall status changed", entity: "recall", entityId: id, detail: `${status}${resolution?.resolutionNote ? ` · ${resolution.resolutionNote}` : ""}` });
}

/**
 * Raises a debit note to the supplier for every recalled batch with stock at the current branch, and marks
 * the recall "Supplier return raised". Opening-stock batches (no supplier) are left for a write-off.
 */
export async function returnRecalled(ctx: Ctx, id: string) {
  authorize(ctx, "purchase");
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${"recall:" + id}))`;
    const r = await tx.recall.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!r) throw new UserError("Recall not found.");
    const bs = (await affectedBatches(tx, ctx.tenantId, r, { branchId: ctx.branchId, qtyAvailable: { gt: 0 } })).sort((a, b) => a.batchNo.localeCompare(b.batchNo));
    const returnable = bs.filter((b) => b.supplierId);
    if (!returnable.length) throw new UserError(bs.length ? "The recalled stock here is opening stock with no supplier on record. Write it off instead." : `No recalled stock left at ${ctx.branchName}.`);
    const notes: string[] = [];
    for (const b of returnable) notes.push(await returnToSupplierIn(tx, ctx, b.id, b.qtyAvailable, `Recall ${r.sourceRef}`, { recall: true }));
    await tx.recall.update({ where: { id }, data: { status: "supplier_return" } });
    await writeAudit(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: `Recall supplier return ${r.sourceRef}`, entity: "recall", entityId: id, detail: `${notes.join(", ")}${bs.length > returnable.length ? ` · ${bs.length - returnable.length} opening-stock batch(es) not returnable` : ""}` });
    return { notes, skipped: bs.filter((b) => !b.supplierId).map((b) => `${b.medicine.name} ${b.batchNo}`) };
  });
}
