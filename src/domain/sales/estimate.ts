import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorize, can, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { nextSeq } from "@/server/sequence";
import { addDays, dateOnly, isoOf, todayISO } from "@/lib/dates";
import { big } from "@/lib/money";
import { zId } from "@/lib/id";

// Estimates (quotations): a priced list for a customer who is not buying yet. Nothing is reserved and no stock,
// voucher or sale is created; prices are the current MRP of the medicine's first sellable batch (else its catalogue
// MRP) and stock and price are confirmed again when the bill is made.

export const estimateSchema = z.object({
  customerName: z.string().trim().max(120).default(""),
  phone: z.string().transform((s) => s.replace(/\D/g, "").replace(/^(91|0)(?=[6-9]\d{9}$)/, "")).refine((p) => p === "" || /^[6-9]\d{9}$/.test(p), "Enter a valid 10-digit mobile number.").default(""),
  validDays: z.number().int().min(1, "Valid for at least 1 day.").max(90, "Valid for at most 90 days.").default(7),
  notes: z.string().trim().max(300).default(""),
  lines: z.array(z.object({ medicineId: zId(), qty: z.number().int().min(1).max(10_000) })).min(1, "Add at least one medicine.").max(100),
});
export type EstimateInput = z.input<typeof estimateSchema>;
type Line = { medicineId: string; name: string; strength: string; qty: number; mrpPaise: number; gstRate: number; amountPaise: number };

export async function createEstimate(ctx: Ctx, raw: EstimateInput) {
  authorize(ctx, "sale");
  const i = estimateSchema.parse(raw);
  const ids = [...new Set(i.lines.map((l) => l.medicineId))];
  const [meds, batches] = await Promise.all([
    db.medicine.findMany({ where: { tenantId: ctx.tenantId, active: true, id: { in: ids } } }),
    db.batch.findMany({ where: { tenantId: ctx.tenantId, branchId: ctx.branchId, medicineId: { in: ids }, status: "ok", qtyAvailable: { gt: 0 }, expiryDate: { gt: dateOnly(todayISO()) } }, orderBy: { expiryDate: "asc" } }),
  ]);
  const lines: Line[] = i.lines.map((l) => {
    const m = meds.find((x) => x.id === l.medicineId);
    if (!m) throw new UserError("One of the medicines isn’t in the catalogue any more.");
    const mrp = big((batches.find((b) => b.medicineId === m.id)?.mrpPaise) ?? m.mrpPaise);
    return { medicineId: m.id, name: m.name, strength: m.strength, qty: l.qty, mrpPaise: mrp, gstRate: m.gstRate, amountPaise: mrp * l.qty };
  });
  const total = lines.reduce((a, l) => a + l.amountPaise, 0);
  if (total <= 0) throw new UserError("These medicines have no price yet. Set the MRP in Inventory first.");
  return db.$transaction(async (tx) => {
    const no = `EST-${String(await nextSeq(tx, ctx.tenantId, "EST")).padStart(4, "0")}`;
    const e = await tx.estimate.create({ data: { tenantId: ctx.tenantId, branchId: ctx.branchId, no, customerName: i.customerName, phone: i.phone, validUntil: dateOnly(addDays(todayISO(), i.validDays)), notes: i.notes, lines, totalPaise: BigInt(total), userId: ctx.userId } });
    await writeAudit(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: "Estimate created", entity: "estimate", entityId: e.id, detail: `${no} · ${lines.length} item${lines.length === 1 ? "" : "s"} · ₹${(total / 100).toFixed(2)}` });
    return { id: e.id, no };
  });
}

const view = (e: { id: string; no: string; customerName: string; phone: string; validUntil: Date; notes: string; lines: unknown; totalPaise: bigint; status: string; createdAt: Date }) => {
  const expired = e.status === "open" && isoOf(e.validUntil) < todayISO();
  return { id: e.id, no: e.no, customerName: e.customerName, phone: e.phone, validUntil: isoOf(e.validUntil), notes: e.notes, lines: e.lines as Line[], total: big(e.totalPaise), status: expired ? "expired" : e.status, createdAt: e.createdAt.toISOString() };
};
export type EstimateRow = ReturnType<typeof view>;

/** Estimates of the current branch, newest first. */
export async function listEstimates(ctx: Ctx, opts: { q?: string } = {}) {
  if (!can(ctx, "sale") && !can(ctx, "reports")) throw new UserError("Your role can’t open estimates.");
  const q = (opts.q ?? "").trim();
  const rows = await db.estimate.findMany({
    where: { tenantId: ctx.tenantId, branchId: ctx.branchId, ...(q ? { OR: [{ no: { contains: q, mode: "insensitive" } }, { customerName: { contains: q, mode: "insensitive" } }, { phone: { contains: q } }] } : {}) },
    orderBy: { createdAt: "desc" }, take: 200,
  });
  return rows.map(view);
}

export async function estimateData(ctx: Ctx, id: string) {
  const e = await db.estimate.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!e || !ctx.branches.some((b) => b.id === e.branchId)) return null;
  const [tenant, branch, user] = await Promise.all([
    db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } }), db.branch.findUniqueOrThrow({ where: { id: e.branchId } }), db.user.findFirst({ where: { id: e.userId }, select: { name: true } }),
  ]);
  return { ...view(e), by: user?.name ?? "", pharmacy: { name: tenant.name, legalName: tenant.legalName, gstin: branch.gstin ?? tenant.gstin, address: branch.address } };
}

/** Close an estimate when the customer bought (or won't): "billed" or "cancelled"; reopen with "open". */
export async function setEstimateStatus(ctx: Ctx, id: string, status: "open" | "billed" | "cancelled") {
  authorize(ctx, "sale");
  const e = await db.estimate.findFirst({ where: { id, tenantId: ctx.tenantId, branchId: ctx.branchId } });
  if (!e) throw new UserError("Estimate not found.");
  await db.$transaction(async (tx) => {
    await tx.estimate.update({ where: { id }, data: { status } });
    await writeAudit(tx, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: `Estimate ${status === "open" ? "reopened" : status}`, entity: "estimate", entityId: id, detail: e.no });
  });
}
