import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorize, authorizeAny, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { nextSeq, pad } from "@/server/sequence";
import { dateOnly, daysTo, isoOf } from "@/lib/dates";

export const RECALL_STATUS = ["open", "investigating", "supplier_return", "resolved"] as const;
export const recallSchema = z.object({
  medicineId: z.string().uuid({ message: "Choose the medicine from your catalogue." }), batches: z.string().trim().min(1, "Enter the affected batch numbers."),
  source: z.string().trim().min(3, "Enter where the notice came from."), publishedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Enter the publication date."),
  reason: z.string().trim().max(200).default(""),
});

/** Recalls name a product and its batch numbers; the same batch number on another medicine isn't affected. */
const affects = (r: { medicineId: string | null; batchNos: string[] }, b: { medicineId: string; batchNo: string }) => r.batchNos.includes(b.batchNo) && (!r.medicineId || r.medicineId === b.medicineId);

export async function listRecalls(ctx: Ctx) {
  const recalls = await db.recall.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: "desc" } });
  const allNos = [...new Set(recalls.flatMap((r) => r.batchNos))];
  const batches = allNos.length ? await db.batch.findMany({ where: { tenantId: ctx.tenantId, batchNo: { in: allNos } }, include: { medicine: { select: { name: true } } } }) : [];
  const branches = await db.branch.findMany({ where: { tenantId: ctx.tenantId }, select: { id: true, name: true } });
  return recalls.map((r) => ({
    id: r.id, ref: r.sourceRef, product: r.product, source: r.source, publishedAt: isoOf(r.publishedAt), reason: r.reason, status: r.status, batchNos: r.batchNos,
    matches: batches.filter((b) => affects(r, b)).map((b) => ({ id: b.id, medicine: b.medicine.name, batchNo: b.batchNo, branch: branches.find((x) => x.id === b.branchId)?.name ?? "", qty: b.qtyAvailable, status: b.status, sellable: b.status === "ok" && b.qtyAvailable > 0 && daysTo(b.expiryDate) > 0 })),
  }));
}

export async function addRecall(ctx: Ctx, raw: z.input<typeof recallSchema>) {
  authorizeAny(ctx, "adjust", "users");
  const i = recallSchema.parse(raw);
  const nos = [...new Set(i.batches.toUpperCase().split(/[\s,;]+/).filter(Boolean))];
  if (daysTo(i.publishedAt) > 0) throw new UserError("Publication date can’t be in the future.");
  return db.$transaction(async (tx) => {
    const m = await tx.medicine.findFirst({ where: { id: i.medicineId, tenantId: ctx.tenantId } });
    if (!m) throw new UserError("Medicine not found.");
    const product = `${m.name} ${m.strength}`.trim();
    const ref = `RC-${pad(await nextSeq(tx, ctx.tenantId, "RC"))}`;
    const r = await tx.recall.create({ data: { tenantId: ctx.tenantId, source: i.source, sourceRef: ref, publishedAt: dateOnly(i.publishedAt), product, medicineId: m.id, batchNos: nos, reason: i.reason || "Not specified", status: "open", createdBy: ctx.userId } });
    await writeAudit(tx, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: `Recall notice recorded ${ref}`, entity: "recall", entityId: r.id, detail: `${product} · ${nos.join(", ")} · source: ${i.source}` });
    return ref;
  });
}

/** Quarantines every sellable matching batch in branches the user can access. */
export async function quarantineRecall(ctx: Ctx, id: string) {
  authorize(ctx, "adjust");
  return db.$transaction(async (tx) => {
    const r = await tx.recall.findFirst({ where: { id, tenantId: ctx.tenantId } });
    if (!r) throw new UserError("Recall not found.");
    const branchIds = ctx.branches.map((b) => b.id);
    const bs = await tx.batch.findMany({ where: { tenantId: ctx.tenantId, batchNo: { in: r.batchNos }, status: "ok", branchId: { in: branchIds }, ...(r.medicineId ? { medicineId: r.medicineId } : {}) } });
    for (const b of bs) {
      await tx.batch.update({ where: { id: b.id }, data: { status: "quarantine", statusNote: `Recall ${r.sourceRef}`, version: { increment: 1 } } });
      await tx.stockMovement.create({ data: { tenantId: ctx.tenantId, branchId: b.branchId, batchId: b.id, qty: 0, type: "quarantine", refType: "recall", refId: r.id, userId: ctx.userId, note: `Recall ${r.sourceRef}` } });
    }
    if (r.status === "open") await tx.recall.update({ where: { id }, data: { status: "investigating" } });
    await writeAudit(tx, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: `Recall quarantine ${r.sourceRef}`, entity: "recall", entityId: id, detail: `${bs.length} batch(es) blocked` });
    return bs.length;
  });
}

export async function setRecallStatus(ctx: Ctx, id: string, status: (typeof RECALL_STATUS)[number]) {
  authorizeAny(ctx, "adjust", "users");
  if (!RECALL_STATUS.includes(status)) throw new UserError("Unknown status.");
  const r = await db.recall.updateMany({ where: { id, tenantId: ctx.tenantId }, data: { status } });
  if (!r.count) throw new UserError("Recall not found.");
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Recall status changed", entity: "recall", entityId: id, detail: status });
}
