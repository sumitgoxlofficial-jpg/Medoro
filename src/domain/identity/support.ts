import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import { db, type Tx } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorize, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { clientInfo, createSession } from "@/server/auth";

/**
 * Owner-granted support access. The owner creates a single-use link that signs Medoro support
 * in as a dedicated, read-only "Medoro support" user until the grant expires or is revoked.
 * Read-only is enforced on the server (authorize() and run() refuse every change and download).
 */

const SUPPORT_ROLE = "Medoro support (read-only)";
/** What support can look at. Changes are refused regardless, because the session is read-only. */
const VIEW_PERMS = ["sale", "disc", "credit", "refund", "adjust", "purchase", "payments", "reports", "integrations"];
const sha = (s: string) => createHash("sha256").update(s).digest("hex");

export const grantSchema = z.object({
  minutes: z.coerce.number<string | number>().refine((m) => [60, 120, 240].includes(m), "Choose 1, 2 or 4 hours."),
  reason: z.string().trim().min(3, "Say why support needs access, e.g. the ticket number.").max(200),
});

async function supportUser(tx: Tx, tenantId: string) {
  const role = await tx.role.upsert({
    where: { tenantId_name: { tenantId, name: SUPPORT_ROLE } },
    create: { tenantId, name: SUPPORT_ROLE, permissions: VIEW_PERMS, locked: true },
    update: { permissions: VIEW_PERMS, locked: true },
  });
  return (await tx.user.findFirst({ where: { tenantId, isSupport: true } }))
    ?? tx.user.create({ data: { tenantId, name: "Medoro support", roleId: role.id, isSupport: true, active: true, branchIds: [] } });
}

export async function grantSupport(ctx: Ctx, raw: z.input<typeof grantSchema>, origin: string) {
  authorize(ctx, "users");
  const i = grantSchema.parse(raw);
  const token = randomBytes(24).toString("base64url");
  const expiresAt = new Date(Date.now() + i.minutes * 60_000);
  await db.$transaction(async (tx) => {
    await supportUser(tx, ctx.tenantId);
    // One grant at a time: a new one replaces any that's still open.
    await tx.supportGrant.updateMany({ where: { tenantId: ctx.tenantId, revokedAt: null, expiresAt: { gt: new Date() } }, data: { revokedAt: new Date(), revokedBy: `${ctx.userName} (replaced)` } });
    await tx.supportGrant.create({ data: { tenantId: ctx.tenantId, tokenHash: sha(token), reason: i.reason, minutes: i.minutes, createdById: ctx.userId, createdBy: ctx.userName, expiresAt } });
    await writeAudit(tx, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Support access granted", entity: "support", detail: `${i.minutes / 60} h, read-only · ${i.reason}` });
  });
  return { link: `${origin}/support/${token}`, expiresAt: expiresAt.toISOString() };
}

/** Ends support access now: the open grant and any support session. */
export async function revokeSupport(ctx: Ctx) {
  authorize(ctx, "users");
  const now = new Date();
  const u = await db.user.findFirst({ where: { tenantId: ctx.tenantId, isSupport: true } });
  const g = await db.supportGrant.updateMany({ where: { tenantId: ctx.tenantId, revokedAt: null, expiresAt: { gt: now } }, data: { revokedAt: now, revokedBy: ctx.userName } });
  if (u) await db.$transaction([
    db.session.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: now } }),
    db.user.update({ where: { id: u.id }, data: { tokenVersion: { increment: 1 } } }),
  ]);
  if (g.count) await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Support access revoked", entity: "support", detail: "Ended by the pharmacy" });
}

export async function supportStatus(ctx: Ctx) {
  const rows = await db.supportGrant.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: "desc" }, take: 10 });
  const now = Date.now();
  return rows.map((g) => ({
    id: g.id, reason: g.reason, minutes: g.minutes, createdBy: g.createdBy, createdAt: g.createdAt.toISOString(), expiresAt: g.expiresAt.toISOString(),
    usedAt: g.usedAt?.toISOString() ?? null, usedIp: g.usedIp, revokedAt: g.revokedAt?.toISOString() ?? null, revokedBy: g.revokedBy,
    active: !g.revokedAt && g.expiresAt.getTime() > now,
  }));
}

/** For the landing page: what the link would do, without using it. */
export async function grantInfo(token: string) {
  const g = await db.supportGrant.findUnique({ where: { tokenHash: sha(String(token ?? "")) } });
  if (!g || g.revokedAt || g.usedAt || g.expiresAt < new Date()) return null;
  const t = await db.tenant.findUnique({ where: { id: g.tenantId }, select: { name: true } });
  return { pharmacy: t?.name ?? "", grantedBy: g.createdBy, reason: g.reason, expiresAt: g.expiresAt.toISOString() };
}

/** Uses the link once: signs in as the read-only support user until the grant expires. */
export async function redeemGrant(token: string) {
  const { ip } = await clientInfo();
  const now = new Date();
  // Atomic claim: a link can only be used once.
  const claimed = await db.supportGrant.updateMany({ where: { tokenHash: sha(String(token ?? "")), usedAt: null, revokedAt: null, expiresAt: { gt: now } }, data: { usedAt: now, usedIp: ip } });
  if (claimed.count !== 1) throw new UserError("This support link has expired, was revoked or was already used. Ask the pharmacy for a new one.");
  const g = await db.supportGrant.findUniqueOrThrow({ where: { tokenHash: sha(token) } });
  const u = await db.$transaction((tx) => supportUser(tx, g.tenantId));
  await createSession(u.id, u.tokenVersion, { device: "Medoro support (read-only)", mfaPassed: true, expiresAt: g.expiresAt });
  await writeAudit(db, { tenantId: g.tenantId, userId: u.id, userName: "Medoro support", action: "Support session started", entity: "support", detail: `read-only until ${g.expiresAt.toISOString().slice(11, 16)} UTC · ${ip ?? "unknown IP"} · ${g.reason}` });
}

/** Support sessions also end when their grant is revoked or expires. */
export async function activeGrantEnd(tenantId: string) {
  const g = await db.supportGrant.findFirst({ where: { tenantId, revokedAt: null, usedAt: { not: null }, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
  return g?.expiresAt ?? null;
}
