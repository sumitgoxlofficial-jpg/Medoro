import "server-only";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { ReadOnlyError, can, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { ForbiddenError } from "@/domain/identity/permissions";
import { getPrivacy } from "@/domain/system/privacy";
import { resolveProvider, type AiMode, type Provider } from "./llm";

/** Pharmacy-level assistant settings, stored under Tenant.settings.ai. */
export type AiSettings = { enabled: boolean; remoteNames: boolean };
const DEFAULT: AiSettings = { enabled: true, remoteNames: false };

/** AI_ENABLED=0/false/off switches the assistant off for every pharmacy on this server. */
export const aiGloballyEnabled = () => !/^(0|false|off|no)$/i.test((process.env.AI_ENABLED ?? "").trim());

export async function getAiSettings(tenantId: string): Promise<AiSettings> {
  const t = await db.tenant.findUniqueOrThrow({ where: { id: tenantId }, select: { settings: true } });
  return { ...DEFAULT, ...((t.settings as { ai?: Partial<AiSettings> }).ai ?? {}) };
}

/** Owners and managers can switch the assistant on or off; only the owner (users) decides what a remote model may see. */
export const canManageAi = (ctx: Ctx) => !ctx.readOnly && (can(ctx, "users") || ctx.role === "Manager");

export async function saveAiSettings(ctx: Ctx, patch: Partial<AiSettings>) {
  if (ctx.readOnly) throw new ReadOnlyError();
  if (!canManageAi(ctx)) throw new ForbiddenError("users");
  if (patch.remoteNames !== undefined && !can(ctx, "users")) throw new ForbiddenError("users");
  const cur = await getAiSettings(ctx.tenantId);
  const next: AiSettings = { enabled: patch.enabled ?? cur.enabled, remoteNames: patch.remoteNames ?? cur.remoteNames };
  if (typeof next.enabled !== "boolean" || typeof next.remoteNames !== "boolean") throw new UserError("Invalid setting.");
  // jsonb_set keeps concurrent writers of other settings keys intact.
  await db.$executeRaw`UPDATE "Tenant" SET settings = jsonb_set(COALESCE(settings, '{}'::jsonb), '{ai}', ${JSON.stringify(next)}::jsonb) WHERE id = ${ctx.tenantId}`;
  const changed = (Object.keys(next) as (keyof AiSettings)[]).filter((k) => next[k] !== cur[k]);
  if (changed.length) await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "AI settings changed", entity: "tenant", detail: changed.map((k) => `${k}: ${cur[k]} → ${next[k]}`).join(" · ") });
  return next;
}

export type AiStatus = { enabled: boolean; globalOff: boolean; mode: AiMode; note?: string; canManage: boolean; remoteNames: boolean };

/** What the drawer shows and which model plans questions for this pharmacy right now. */
export async function aiStatus(ctx: Ctx): Promise<AiStatus & { provider: Provider | null }> {
  const [s, p] = await Promise.all([getAiSettings(ctx.tenantId), getPrivacy(ctx.tenantId)]);
  const r = resolveProvider(process.env, p);
  return { enabled: aiGloballyEnabled() && s.enabled, globalOff: !aiGloballyEnabled(), mode: r.mode, note: r.note, provider: r.provider, canManage: canManageAi(ctx), remoteNames: s.remoteNames };
}

export async function requireAiEnabled(ctx: Ctx) {
  const st = await aiStatus(ctx);
  if (st.globalOff) throw new UserError("The AI assistant is switched off on this server.");
  if (!st.enabled) throw new UserError("The AI assistant is switched off for this pharmacy.");
  return st;
}
