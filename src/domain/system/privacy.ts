import "server-only";
import { db, type Tx } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorize, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { customerBalance } from "@/domain/parties/balances";
import { maskPhone } from "@/lib/mask";
import { toCsv } from "@/lib/csv-format";
import { z } from "zod";

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

/** Grievance officer printed on invoices and receipts (DPDP). Falls back to the pharmacy's own contact. */
export type Grievance = { name: string; email: string; phone: string };
const grievanceSchema = z.object({
  name: z.string().trim().max(80).default(""),
  email: z.string().trim().max(120).refine((e) => !e || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e), "Enter a valid email.").default(""),
  phone: z.string().trim().max(20).refine((p) => !p || /^[+\d][\d\s-]{6,}$/.test(p), "Enter a valid phone number.").default(""),
});

export async function getGrievance(tenantId: string): Promise<Grievance> {
  const t = await db.tenant.findUniqueOrThrow({ where: { id: tenantId } });
  return { name: "", email: "", phone: "", ...((t.settings as { grievance?: Partial<Grievance> }).grievance ?? {}) };
}

export async function saveGrievance(ctx: Ctx, raw: Partial<Grievance>) {
  authorize(ctx, "users");
  const g = grievanceSchema.parse(raw);
  if (g.name && !g.email && !g.phone) throw new UserError("Add an email or phone number for the grievance officer.");
  const t = await db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
  await db.tenant.update({ where: { id: ctx.tenantId }, data: { settings: { ...(t.settings as object), grievance: g } } });
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Grievance officer updated", entity: "tenant", detail: g.name || "cleared" });
  return g;
}

/** Footer line for invoices: the grievance officer if set, else the pharmacy's phone. */
export const invoiceGrievance = (t: { phone: string | null; settings: unknown }) => grievanceLine({ name: "", email: "", phone: "", ...((t.settings as { grievance?: Partial<Grievance> }).grievance ?? {}) }, t.phone);

export function grievanceLine(g: Grievance, fallbackPhone?: string | null) {
  const contact = [g.email, g.phone].filter(Boolean).join(", ");
  if (g.name || contact) return `Grievance officer: ${[g.name, contact].filter(Boolean).join(", ")}`;
  return fallbackPhone ? `Questions about your data: call the pharmacy on ${fallbackPhone}` : "Questions about your data: ask at the counter";
}

/** Clears a customer's personal fields and the numbers on their WhatsApp log. Invoices stay, linked to the anonymised record. */
export async function anonymiseCustomer(tx: Tx, tenantId: string, c: { id: string; phone: string | null }, label = "Erased customer") {
  const ref = c.id.slice(0, 8).toUpperCase();
  await tx.customer.update({ where: { id: c.id }, data: { name: `${label} ${ref}`, phone: null, waOptIn: false, smsOptIn: false, marketingWa: false, marketingSms: false, optInAt: null, optInMethod: null, creditLimitPaise: 0n, erasedAt: new Date() } });
  const sales = await tx.sale.findMany({ where: { tenantId, customerId: c.id }, select: { id: true } });
  await tx.waMessage.updateMany({
    where: { tenantId, OR: [{ invoiceId: { in: sales.map((x) => x.id) } }, ...(c.phone ? [{ recipient: c.phone }] : [])] },
    data: { recipient: "erased" },
  });
  return ref;
}

/** Removes a customer's personal fields. Invoices stay, linked to the anonymised record. */
export async function eraseCustomer(ctx: Ctx, customerId: string) {
  authorize(ctx, "users");
  return db.$transaction(async (tx) => {
    const c = await tx.customer.findFirst({ where: { id: customerId, tenantId: ctx.tenantId, erasedAt: null } });
    if (!c) throw new UserError("Customer not found.");
    const due = await customerBalance(tx, ctx.tenantId, c.id);
    if (due !== 0) throw new UserError(`${c.name} has an outstanding balance. Settle it before erasure.`);
    const ref = await anonymiseCustomer(tx, ctx.tenantId, c);
    await writeAudit(tx, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Customer data erased", entity: "customer", entityId: c.id, detail: `${ref} · invoices kept with anonymised party for tax records` });
  });
}

/** Every row the pharmacy owns. Secrets (password/PIN hashes, invite codes, token hashes, sealed tokens) are excluded. */
export async function dumpTenant(tenantId: string) {
  const T = { tenantId };
  const [tenant, branches, counters, roles, users, medicines, batches, movements, suppliers, customers, sales, returns, shifts, vouchers, grns, pos, bills, counts, transfers, recalls, stockOuts, wa, backups, audit, documents, devices, offlineOps, campaigns, invites, subscription, supportGrants, heldCarts, consentRecords] = await Promise.all([
    db.tenant.findUnique({ where: { id: tenantId } }), db.branch.findMany({ where: T }), db.counter.findMany({ where: T }), db.role.findMany({ where: T }),
    db.user.findMany({ where: T, select: { id: true, name: true, email: true, phone: true, employeeNo: true, roleId: true, branchIds: true, permGrants: true, permRevokes: true, active: true, mfaEnabled: true, createdAt: true, lastLoginAt: true } }),
    db.medicine.findMany({ where: T }), db.batch.findMany({ where: T }), db.stockMovement.findMany({ where: T }), db.supplier.findMany({ where: T }), db.customer.findMany({ where: T }),
    db.sale.findMany({ where: T, include: { items: true, payments: true } }), db.salesReturn.findMany({ where: T }), db.shift.findMany({ where: T }),
    db.voucher.findMany({ where: T, include: { lines: true } }), db.grn.findMany({ where: T, include: { items: true } }), db.purchaseOrder.findMany({ where: T, include: { items: true } }),
    db.supplierBill.findMany({ where: T }), db.stockCount.findMany({ where: T }), db.transfer.findMany({ where: T }), db.recall.findMany({ where: T }), db.stockOut.findMany({ where: T }),
    db.waMessage.findMany({ where: T }), db.backupManifest.findMany({ where: T }), db.auditEvent.findMany({ where: T }),
    db.scanDocument.findMany({ where: T }), db.device.findMany({ where: T }), db.offlineOp.findMany({ where: T }), db.campaign.findMany({ where: T }),
    db.invite.findMany({ where: T, omit: { code: true } }), db.subscriptionMeta.findUnique({ where: T, omit: { licenceToken: true } }),
    db.supportGrant.findMany({ where: T, omit: { tokenHash: true } }), db.heldCart.findMany({ where: T }), db.consentRecord.findMany({ where: T }),
  ]);
  const [supplierClaims, cheques, bankStatements, bankLines, supplierItemMaps] = await Promise.all([
    db.supplierClaim.findMany({ where: T }), db.cheque.findMany({ where: T }), db.bankStatement.findMany({ where: T }), db.bankLine.findMany({ where: T }), db.supplierItemMap.findMany({ where: T }),
  ]);
  return { exportedAt: new Date().toISOString(), format: "medoro-export-v1", tenant, branches, counters, roles, users, medicines, batches, movements, suppliers, customers, sales, returns, shifts, vouchers, grns, purchaseOrders: pos, supplierBills: bills, stockCounts: counts, transfers, recalls, stockOuts, whatsappMessages: wa, backups, audit, scanDocuments: documents, devices, offlineOps, campaigns, invites, subscription, supportGrants, heldCarts, consentRecords, supplierClaims, cheques, bankStatements, bankLines, supplierItemMaps };
}

export type ExportOptions = { reason?: string };

/** Full export. In strict mode customer mobile numbers are masked unless a reason is recorded (it goes to the audit trail). */
export async function fullExport(ctx: Ctx, opts: ExportOptions = {}, format: "json" | "csv" = "json") {
  authorize(ctx, "users");
  const reason = opts.reason?.trim() ?? "";
  if (reason && reason.length < 5) throw new UserError("Describe the reason in a few words.");
  const d = await dumpTenant(ctx.tenantId);
  const masked = !reason && (await getPrivacy(ctx.tenantId)).strict;
  if (masked) {
    for (const c of d.customers) c.phone = maskPhone(c.phone);
    for (const m of d.whatsappMessages) m.recipient = maskPhone(m.recipient) ?? "";
  }
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Full data export", entity: "tenant",
    detail: `${format.toUpperCase()} · ${d.sales.length} sales · ${d.vouchers.length} vouchers · ${masked ? "customer phones masked (strict mode)" : reason ? `customer phones included · reason: ${reason.slice(0, 120)}` : "customer phones included"}` });
  return d;
}

const cell = (v: unknown): string | number | null => {
  if (v == null) return null;
  if (typeof v === "bigint") return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Uint8Array) return null;
  if (typeof v === "object") return JSON.stringify(v, (_, x) => (typeof x === "bigint" ? x.toString() : x));
  return v as string | number;
};
const kebab = (s: string) => s.replace(/[A-Z]/g, (c) => "-" + c.toLowerCase());

/** One CSV per table (child rows such as sale items get their own file), as {name, text}. */
export function exportCsvFiles(d: Awaited<ReturnType<typeof dumpTenant>>) {
  const files: { name: string; data: string }[] = [];
  const add = (name: string, rows: Record<string, unknown>[]) => {
    const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))].filter((k) => !rows.some((r) => Array.isArray(r[k])));
    files.push({ name: `${name}.csv`, data: toCsv([cols, ...rows.map((r) => cols.map((k) => cell(r[k])))]) });
    for (const k of new Set(rows.flatMap((r) => Object.keys(r).filter((x) => Array.isArray(r[x]))))) add(`${name}-${kebab(k)}`, rows.flatMap((r) => (r[k] as Record<string, unknown>[] | undefined) ?? []));
  };
  for (const [k, v] of Object.entries(d)) {
    if (Array.isArray(v)) add(kebab(k), v as Record<string, unknown>[]);
    else if (v && typeof v === "object") add(kebab(k), [v as Record<string, unknown>]);
  }
  files.unshift({ name: "README.txt", data: `Medoro full export (${d.format}), ${d.exportedAt}.\r\nOne CSV per table, UTF-8 with BOM. Amounts are in paise. Child rows (sale items, payments, ledger lines, GRN and PO items) are in their own files with the parent id.\r\nPasswords, PINs, invite codes, token hashes and integration secrets are not included.\r\n` });
  return files;
}
