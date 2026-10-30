import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { Prisma } from "@prisma/client";
import { db, type DbOrTx, type Tx } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorize, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { checkLock, clearFailures, recordFailure, verifyPassword } from "@/server/auth";
import { big, cartTotals, inr } from "@/lib/money";
import { discountCap } from "@/domain/identity/permissions";
import { normPhone } from "@/domain/identity/contracts";
import { saleSchema } from "./contracts";

const APPROVAL_MINUTES = 10;
export const DEFAULT_MAX_DISCOUNT = 50;
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

/** The most discount any bill may carry, approval or not (tenant setting `maxDiscountPct`, never 100%). */
export async function maxDiscount(tenantId: string, q: DbOrTx = db) {
  const t = await q.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true } });
  const v = Number((t.settings as { maxDiscountPct?: number }).maxDiscountPct ?? DEFAULT_MAX_DISCOUNT);
  return Number.isFinite(v) ? Math.min(Math.max(v, 0), 99) : DEFAULT_MAX_DISCOUNT;
}

/** What an approval is bound to: the exact batches and quantities, and the discount. */
export function cartHash(lines: { batchId: string; qty: number }[], discountPct: number) {
  const per = lines.reduce<Record<string, number>>((m, l) => ({ ...m, [l.batchId]: (m[l.batchId] ?? 0) + l.qty }), {});
  return sha(JSON.stringify([Object.entries(per).sort(), discountPct]));
}

export const approvalSchema = z.object({
  approver: z.string().trim().min(3, "Enter the manager’s employee ID, email or mobile.").max(120),
  secret: z.string().min(4, "Enter the manager’s PIN or password.").max(200),
  lines: saleSchema.shape.lines,
  discountPct: saleSchema.shape.discountPct,
});

/**
 * A manager approves a discount above the cashier's cap at the counter with their own PIN or password.
 * Wrong attempts lock that manager's approvals (and this cashier's requests) like a failed sign-in.
 * The token is single-use, expires in minutes, and only fits this cart and discount.
 */
export async function approveDiscount(ctx: Ctx, raw: z.input<typeof approvalSchema>) {
  authorize(ctx, "sale");
  const i = approvalSchema.parse(raw);
  const max = await maxDiscount(ctx.tenantId);
  if (i.discountPct > max) throw new UserError(`Discounts above ${max}% aren’t allowed.`);
  if (i.discountPct <= discountCap(ctx.perms)) throw new UserError("This discount doesn’t need approval.");
  const who = i.approver.toLowerCase();
  const keys = ["approve:" + ctx.tenantId + ":" + who, "approve-by:" + ctx.userId];
  const mins = await checkLock(keys);
  if (mins) throw new UserError(`Too many wrong attempts. Try again in ${mins} min.`);
  const phone = normPhone(i.approver);
  const u = await db.user.findFirst({
    where: { tenantId: ctx.tenantId, active: true, isSupport: false, OR: [{ employeeNo: i.approver.toUpperCase() }, { email: who }, ...(/^\d{10}$/.test(phone) ? [{ phone }] : [])] },
    include: { role: true },
  });
  const allowed = !!u && u.role.permissions.includes("disc") && (!u.branchIds.length || u.branchIds.includes(ctx.branchId));
  const good = allowed && ((await verifyPassword(u.pinHash, i.secret)) || (await verifyPassword(u.passwordHash, i.secret)));
  if (!good) {
    const left = await recordFailure(keys);
    await writeAudit(db, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: "Discount approval refused", entity: "sale", detail: `${i.discountPct}% · approver “${i.approver.slice(0, 40)}”` });
    throw new UserError(left ? `Wrong ID or PIN/password, or this person can’t approve discounts. ${left} attempt${left > 1 ? "s" : ""} left.` : "Too many wrong attempts. Discount approval is locked for 15 minutes.");
  }
  await clearFailures(keys);

  const ids = [...new Set(i.lines.map((l) => l.batchId))];
  const batches = await db.batch.findMany({ where: { id: { in: ids }, tenantId: ctx.tenantId, branchId: ctx.branchId }, include: { medicine: { select: { gstRate: true } } } });
  if (batches.length !== ids.length) throw new UserError("A cart line doesn’t match this branch’s stock. Review the cart.");
  const t = cartTotals(i.lines.map((l) => { const b = batches.find((x) => x.id === l.batchId)!; return { mrpPaise: big(b.mrpPaise), qty: l.qty, gstRate: b.medicine.gstRate }; }), i.discountPct);
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + APPROVAL_MINUTES * 60_000);
  const a = await db.discountApproval.create({
    data: { tenantId: ctx.tenantId, branchId: ctx.branchId, tokenHash: sha(token), requestedBy: ctx.userId, approvedBy: u.id, discountPct: new Prisma.Decimal(i.discountPct), cartHash: cartHash(i.lines, i.discountPct), totalPaise: BigInt(t.total), expiresAt },
  });
  await writeAudit(db, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: u.id, userName: u.name, action: "Discount approved", entity: "discount_approval", entityId: a.id, detail: `${i.discountPct}% on ${inr(t.total)} for ${ctx.userName}` });
  return { token, approver: u.name, discountPct: i.discountPct, total: t.total, expiresAt: expiresAt.toISOString() };
}

/** Uses up an approval inside the sale's transaction (rolled back with it if the sale fails). Returns the approver's name. */
export async function consumeApproval(tx: Tx, ctx: Ctx, token: string, lines: { batchId: string; qty: number }[], discountPct: number, total: number) {
  const rows = await tx.$queryRaw<{ id: string; cartHash: string; discountPct: Prisma.Decimal; totalPaise: bigint; approvedBy: string }[]>`
    UPDATE "DiscountApproval" SET "usedAt" = now() WHERE "tokenHash" = ${sha(token)} AND "tenantId" = ${ctx.tenantId} AND "branchId" = ${ctx.branchId}
      AND "requestedBy" = ${ctx.userId} AND "usedAt" IS NULL AND "expiresAt" > now()
    RETURNING id, "cartHash", "discountPct", "totalPaise", "approvedBy"`;
  const a = rows[0];
  if (!a) throw new UserError("The manager’s approval has expired or was already used. Ask for approval again.");
  if (a.cartHash !== cartHash(lines, discountPct) || Number(a.discountPct) !== discountPct || big(a.totalPaise) !== total) {
    throw new UserError("The cart changed after the manager approved the discount. Ask for approval again.");
  }
  const by = await tx.user.findUnique({ where: { id: a.approvedBy }, select: { name: true } });
  return { id: a.id, by: by?.name ?? "manager" };
}
