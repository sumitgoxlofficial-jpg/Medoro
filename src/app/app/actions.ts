"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { BRANCH_COOKIE, LANG_COOKIE, VIEWAS_COOKIE, getCtx } from "@/server/context";
import { effectivePerms, ROLE_NAMES } from "@/domain/identity/permissions";

const opts = { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", maxAge: 60 * 60 * 24 * 365 };

export async function setBranch(id: string) {
  const ctx = await getCtx();
  if (!ctx || !ctx.branches.some((b) => b.id === id)) return;
  (await cookies()).set(BRANCH_COOKIE, id, opts);
  revalidatePath("/app", "layout");
}

export async function setLang(lang: "en" | "hi") {
  (await cookies()).set(LANG_COOKIE, lang === "hi" ? "hi" : "en", opts);
  revalidatePath("/app", "layout");
}

export async function setViewAs(role: string) {
  const ctx = await getCtx();
  if (!ctx || ctx.realRole === role || !(ROLE_NAMES as readonly string[]).includes(role)) {
    (await cookies()).delete(VIEWAS_COOKIE);
  } else {
    const real = await db.user.findUnique({ where: { id: ctx.userId }, include: { role: true } });
    if (!real || !effectivePerms(real.role.permissions, real.permGrants, real.permRevokes).includes("users")) return;
    (await cookies()).set(VIEWAS_COOKIE, role, { ...opts, maxAge: 60 * 60 * 12 });
  }
  revalidatePath("/app", "layout");
}

export async function listSessions() {
  const ctx = await getCtx();
  if (!ctx) return [];
  const rows = await db.session.findMany({ where: { userId: ctx.userId, revokedAt: null, expiresAt: { gt: new Date() } }, orderBy: { lastSeenAt: "desc" } });
  return rows.map((s) => ({ id: s.id, device: s.device ?? (s.userAgent?.match(/(Edg|Chrome|Firefox|Safari)\/[\d.]+/)?.[1] ?? "Browser"), ip: s.ip, ua: s.userAgent, created: s.createdAt.toISOString(), lastSeen: s.lastSeenAt.toISOString(), isThis: s.id === ctx.sessionId }));
}

export async function revokeSession(id: string) {
  const ctx = await getCtx();
  if (!ctx || id === ctx.sessionId) return;
  const r = await db.session.updateMany({ where: { id, userId: ctx.userId }, data: { revokedAt: new Date() } });
  if (r.count) await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Session revoked", entity: "session" });
}

export async function revokeOtherSessions() {
  const ctx = await getCtx();
  if (!ctx) return;
  await db.session.updateMany({ where: { userId: ctx.userId, revokedAt: null, NOT: { id: ctx.sessionId } }, data: { revokedAt: new Date() } });
  await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "All other sessions revoked", entity: "session" });
}
