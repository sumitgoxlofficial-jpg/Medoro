import "server-only";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorize, authorizeView, type Ctx } from "@/server/context";
import { customerBalances } from "@/domain/parties/balances";
import { anonymiseCustomer, getPrivacy } from "./privacy";

const DAY = 86400_000;

/**
 * What the daily retention job removes or anonymises. Statutory books (sales and items, payments, credit notes, vouchers and
 * ledger lines, GRNs and purchase orders, stock movements, stock-outs, transfers, counts, the audit trail, consent records)
 * are never touched: they are append-only and kept for at least 8 years (GST: 72 months after the annual return's due date;
 * Income-tax: up to 8 years; drug rules: H1 and prescription records 3+ years). Customers on those records are only
 * anonymised, as with an erasure request.
 */
export const RETENTION_RULES = [
  { key: "customers", label: "Customers with no purchase for longer than the retention period", action: "Name and mobile removed (anonymised); invoices kept" },
  { key: "whatsapp", label: "WhatsApp delivery log older than 1 year", action: "Recipient number removed; invoice no. and status kept" },
  { key: "sessions", label: "Sign-in sessions ended over 30 days ago", action: "Deleted" },
  { key: "invites", label: "Invite and reset codes expired or used over 90 days ago", action: "Deleted" },
  { key: "supportGrants", label: "Medoro support access links ended over 1 year ago", action: "Deleted (the audit trail keeps the record)" },
  { key: "heldCarts", label: "Held carts older than 7 days", action: "Deleted" },
  { key: "offlineOps", label: "Offline bills posted or resolved over 90 days ago", action: "Deleted (the posted invoices stay)" },
  { key: "aiConfirmations", label: "AI confirmations expired over 7 days ago", action: "Deleted" },
  { key: "loginAttempts", label: "Sign-in throttling counters idle for 30 days (whole server)", action: "Deleted" },
  { key: "otpCodes", label: "Expired one-time sign-in codes (whole server)", action: "Deleted" },
] as const;
export type RetentionKey = (typeof RETENTION_RULES)[number]["key"];
export type RetentionCounts = Record<RetentionKey, number>;

function windows(now: Date, years: number) {
  const ago = (days: number) => new Date(now.getTime() - days * DAY);
  return { customers: ago(Math.round(years * 365.25)), whatsapp: ago(365), sessions: ago(30), invites: ago(90), supportGrants: ago(365), heldCarts: ago(7), offlineOps: ago(90), aiConfirmations: ago(7), loginAttempts: ago(30), otpCodes: ago(1) };
}

/** Inactive customers: created and last bought (and last changed consent) before the cutoff, with nothing outstanding. */
async function inactiveCustomers(tenantId: string, cutoff: Date) {
  const rows = await db.$queryRaw<{ id: string; phone: string | null }[]>`
    SELECT c.id, c.phone FROM "Customer" c
    WHERE c."tenantId" = ${tenantId} AND c."erasedAt" IS NULL AND c."createdAt" < ${cutoff}
      AND NOT EXISTS (SELECT 1 FROM "Sale" s WHERE s."customerId" = c.id AND s.at >= ${cutoff})
      AND NOT EXISTS (SELECT 1 FROM "ConsentRecord" r WHERE r."customerId" = c.id AND r.at >= ${cutoff})`;
  if (!rows.length) return rows;
  const bal = await customerBalances(db, tenantId);
  return rows.filter((r) => (bal.get(r.id) ?? 0) === 0);
}

function wheres(tenantId: string, w: ReturnType<typeof windows>, now: Date) {
  return {
    whatsapp: { tenantId, createdAt: { lt: w.whatsapp }, recipient: { notIn: ["erased", "redacted"] } } satisfies Prisma.WaMessageWhereInput,
    sessions: { user: { tenantId }, OR: [{ expiresAt: { lt: w.sessions } }, { revokedAt: { lt: w.sessions } }] } satisfies Prisma.SessionWhereInput,
    invites: { tenantId, OR: [{ expiresAt: { lt: w.invites } }, { usedAt: { lt: w.invites } }] } satisfies Prisma.InviteWhereInput,
    supportGrants: { tenantId, expiresAt: { lt: w.supportGrants } } satisfies Prisma.SupportGrantWhereInput,
    heldCarts: { tenantId, createdAt: { lt: w.heldCarts } } satisfies Prisma.HeldCartWhereInput,
    offlineOps: { tenantId, status: { in: ["posted", "resolved"] }, receivedAt: { lt: w.offlineOps } } satisfies Prisma.OfflineOpWhereInput,
    aiConfirmations: { tenantId, expiresAt: { lt: w.aiConfirmations } } satisfies Prisma.AiConfirmationWhereInput,
    loginAttempts: { updatedAt: { lt: w.loginAttempts }, OR: [{ lockedUntil: null }, { lockedUntil: { lt: now } }] } satisfies Prisma.LoginAttemptWhereInput,
    otpCodes: { expiresAt: { lt: w.otpCodes } } satisfies Prisma.OtpCodeWhereInput,
  };
}

/** Dry run: how many rows each rule would change now. Nothing is modified. */
export async function retentionPreview(tenantId: string, now = new Date()) {
  const { retentionYears } = await getPrivacy(tenantId);
  const w = windows(now, retentionYears), q = wheres(tenantId, w, now);
  const [customers, whatsapp, sessions, invites, supportGrants, heldCarts, offlineOps, aiConfirmations, loginAttempts, otpCodes] = await Promise.all([
    inactiveCustomers(tenantId, w.customers).then((r) => r.length),
    db.waMessage.count({ where: q.whatsapp }), db.session.count({ where: q.sessions }), db.invite.count({ where: q.invites }),
    db.supportGrant.count({ where: q.supportGrants }), db.heldCart.count({ where: q.heldCarts }), db.offlineOp.count({ where: q.offlineOps }),
    db.aiConfirmation.count({ where: q.aiConfirmations }), db.loginAttempt.count({ where: q.loginAttempts }), db.otpCode.count({ where: q.otpCodes }),
  ]);
  const counts: RetentionCounts = { customers, whatsapp, sessions, invites, supportGrants, heldCarts, offlineOps, aiConfirmations, loginAttempts, otpCodes };
  return { years: retentionYears, customerCutoff: w.customers.toISOString().slice(0, 10), counts };
}

/** Applies the retention rules for one pharmacy (and the server-wide sign-in tables). Writes one audit event. */
export async function applyRetention(tenantId: string, now = new Date(), by?: { id: string; name: string }) {
  const { retentionYears } = await getPrivacy(tenantId);
  const w = windows(now, retentionYears), q = wheres(tenantId, w, now);
  const whatsapp = (await db.waMessage.updateMany({ where: q.whatsapp, data: { recipient: "redacted" } })).count;
  let customers = 0;
  for (const c of await inactiveCustomers(tenantId, w.customers)) {
    await db.$transaction((tx) => anonymiseCustomer(tx, tenantId, c, "Inactive customer"));
    customers++;
  }
  const counts: RetentionCounts = {
    customers,
    whatsapp,
    sessions: (await db.session.deleteMany({ where: q.sessions })).count,
    invites: (await db.invite.deleteMany({ where: q.invites })).count,
    supportGrants: (await db.supportGrant.deleteMany({ where: q.supportGrants })).count,
    heldCarts: (await db.heldCart.deleteMany({ where: q.heldCarts })).count,
    offlineOps: (await db.offlineOp.deleteMany({ where: q.offlineOps })).count,
    aiConfirmations: (await db.aiConfirmation.deleteMany({ where: q.aiConfirmations })).count,
    loginAttempts: (await db.loginAttempt.deleteMany({ where: q.loginAttempts })).count,
    otpCodes: (await db.otpCode.deleteMany({ where: q.otpCodes })).count,
  };
  const changed = RETENTION_RULES.filter((r) => counts[r.key]);
  await writeAudit(db, { tenantId, userId: by?.id ?? null, userName: by?.name ?? "Scheduler", action: "Retention run", entity: "tenant",
    detail: changed.length ? changed.map((r) => `${r.key} ${counts[r.key]}`).join(" · ") : "nothing to remove", after: { retentionYears, counts } });
  return counts;
}

export async function previewRetention(ctx: Ctx) {
  authorizeView(ctx, "users");
  return retentionPreview(ctx.tenantId);
}

export async function runRetentionNow(ctx: Ctx) {
  authorize(ctx, "users");
  return applyRetention(ctx.tenantId, new Date(), { id: ctx.userId, name: ctx.userName });
}
