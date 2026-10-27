import "server-only";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorize, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { customerBalance } from "@/domain/parties/balances";

export type Privacy = { strict: boolean; remoteAi: boolean; telemetry: boolean; crash: boolean; retentionYears: number };
const DEFAULT: Privacy = { strict: true, remoteAi: false, telemetry: false, crash: false, retentionYears: 8 };

export async function getPrivacy(tenantId: string): Promise<Privacy> {
  const t = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  return { ...DEFAULT, ...((t.settings as { privacy?: Partial<Privacy> }).privacy ?? {}) };
}

/** Strict mode and remote AI are mutually exclusive: turning one on turns the other off. */
export async function savePrivacy(ctx: Ctx, patch: Partial<Privacy>) {
  authorize(ctx, "users");
  const cur = await getPrivacy(ctx.tenantId);
  const next: Privacy = { ...cur, ...patch };
  if (patch.strict) next.remoteAi = false;
  if (patch.remoteAi) next.strict = false;
  if (![3, 5, 8, 10].includes(next.retentionYears)) throw new UserError("Choose a retention period.");
  const t = await db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
  await db.tenant.update({ where: { id: ctx.tenantId }, data: { settings: { ...(t.settings as object), privacy: next } } });
  const changed = (Object.keys(next) as (keyof Privacy)[]).filter((k) => next[k] !== cur[k]);
  if (changed.length) await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Privacy settings changed", entity: "tenant", detail: changed.map((k) => `${k}: ${cur[k]} → ${next[k]}`).join(" · ") });
  return next;
}

/** Removes a customer's personal fields. Invoices stay, linked to the anonymised record. */
export async function eraseCustomer(ctx: Ctx, customerId: string) {
  authorize(ctx, "users");
  return db.$transaction(async (tx) => {
    const c = await tx.customer.findFirst({ where: { id: customerId, tenantId: ctx.tenantId, erasedAt: null } });
    if (!c) throw new UserError("Customer not found.");
    const due = await customerBalance(tx, ctx.tenantId, c.id);
    if (due !== 0) throw new UserError(`${c.name} has an outstanding balance. Settle it before erasure.`);
    const ref = c.id.slice(0, 8).toUpperCase();
    await tx.customer.update({ where: { id: c.id }, data: { name: `Erased customer ${ref}`, phone: null, waOptIn: false, optInAt: null, optInMethod: null, creditLimitPaise: 0n, erasedAt: new Date() } });
    await writeAudit(tx, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Customer data erased", entity: "customer", entityId: c.id, detail: `${ref} · invoices kept with anonymised party for tax records` });
  });
}

/** Every row the pharmacy owns. Secrets (password/PIN hashes, sealed tokens) are excluded. */
export async function dumpTenant(tenantId: string) {
  const T = { tenantId };
  const [tenant, branches, counters, roles, users, medicines, batches, movements, suppliers, customers, sales, returns, shifts, vouchers, grns, pos, bills, counts, transfers, recalls, stockOuts, wa, backups, audit] = await Promise.all([
    db.tenant.findUnique({ where: { id: tenantId } }), db.branch.findMany({ where: T }), db.counter.findMany({ where: T }), db.role.findMany({ where: T }),
    db.user.findMany({ where: T, select: { id: true, name: true, email: true, phone: true, employeeNo: true, roleId: true, branchIds: true, active: true, mfaEnabled: true, createdAt: true, lastLoginAt: true } }),
    db.medicine.findMany({ where: T }), db.batch.findMany({ where: T }), db.stockMovement.findMany({ where: T }), db.supplier.findMany({ where: T }), db.customer.findMany({ where: T }),
    db.sale.findMany({ where: T, include: { items: true, payments: true } }), db.salesReturn.findMany({ where: T }), db.shift.findMany({ where: T }),
    db.voucher.findMany({ where: T, include: { lines: true } }), db.grn.findMany({ where: T, include: { items: true } }), db.purchaseOrder.findMany({ where: T, include: { items: true } }),
    db.supplierBill.findMany({ where: T }), db.stockCount.findMany({ where: T }), db.transfer.findMany({ where: T }), db.recall.findMany({ where: T }), db.stockOut.findMany({ where: T }),
    db.waMessage.findMany({ where: T }), db.backupManifest.findMany({ where: T }), db.auditEvent.findMany({ where: T }),
  ]);
  return { exportedAt: new Date().toISOString(), format: "medoro-export-v1", tenant, branches, counters, roles, users, medicines, batches, movements, suppliers, customers, sales, returns, shifts, vouchers, grns, purchaseOrders: pos, supplierBills: bills, stockCounts: counts, transfers, recalls, stockOuts, whatsappMessages: wa, backups, audit };
}

export async function fullExport(ctx: Ctx) {
  authorize(ctx, "users");
  const d = await dumpTenant(ctx.tenantId);
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Full data export", entity: "tenant", detail: `${d.sales.length} sales · ${d.vouchers.length} vouchers` });
  return d;
}
