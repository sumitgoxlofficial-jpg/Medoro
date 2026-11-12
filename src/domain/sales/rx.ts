import "server-only";
import { createHash } from "node:crypto";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorize, can, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { ALLOWED, getObject, putObject } from "@/server/storage";

// The prescription behind a counter bill: a photo or PDF kept beside the sale (the sale row itself never changes).
// Attached from Returns ▸ the bill, at billing time or later; a new upload replaces the earlier one.

export async function attachSaleRx(ctx: Ctx, saleId: string, bytes: Buffer, mime: keyof typeof ALLOWED) {
  authorize(ctx, "sale");
  const s = await db.sale.findFirst({ where: { id: saleId, tenantId: ctx.tenantId }, select: { id: true, branchId: true, invoiceNo: true } });
  if (!s || !ctx.branches.some((b) => b.id === s.branchId)) throw new UserError("Bill not found.");
  const sha = createHash("sha256").update(bytes).digest("hex");
  const path = `${ctx.tenantId}/rx/${sha}.${ALLOWED[mime]}`;
  await putObject(path, bytes, mime);
  await db.$transaction(async (tx) => {
    await tx.salePrescription.upsert({ where: { saleId: s.id }, update: { path, mime, userId: ctx.userId, at: new Date() }, create: { tenantId: ctx.tenantId, branchId: s.branchId, saleId: s.id, path, mime, userId: ctx.userId } });
    await writeAudit(tx, { tenantId: ctx.tenantId, branchId: s.branchId, userId: ctx.userId, userName: ctx.userName, action: "Prescription attached", entity: "sale", entityId: s.id, detail: `${s.invoiceNo} · ${sha.slice(0, 12)}` });
  });
}

/** The prescription file of a bill, for people who bill or see reports at a branch they can access. */
export async function readSaleRx(ctx: Ctx, saleId: string) {
  const r = await db.salePrescription.findFirst({ where: { saleId, tenantId: ctx.tenantId } });
  if (!r || !ctx.branches.some((b) => b.id === r.branchId) || !(can(ctx, "sale") || can(ctx, "reports"))) return null;
  const [bytes, s] = await Promise.all([getObject(r.path), db.sale.findFirst({ where: { id: saleId, tenantId: ctx.tenantId }, select: { invoiceNo: true } })]);
  return bytes ? { bytes, mime: r.mime, name: `${s?.invoiceNo ?? "bill"}-rx.${r.path.split(".").pop()}` } : null;
}
