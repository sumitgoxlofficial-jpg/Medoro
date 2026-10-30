import "server-only";
import { createHash, randomBytes } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { can, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { todayISO } from "@/lib/dates";
import { llmPlan, rulePlan, type Plan } from "./planner";
import { toolFor, toolsFor, type ToolResult } from "./tools";

export type AiReply = ToolResult & {
  tool?: string;
  confirm?: { token: string; label: string; expiresAt: string };
  refused?: boolean;
};

const CONFIRM_MS = 5 * 60_000;
/** Key order is canonicalised because Postgres jsonb doesn't keep it. */
const canon = (v: unknown): unknown => Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon((v as Record<string, unknown>)[k])])) : v;
const hashInput = (v: unknown) => createHash("sha256").update(JSON.stringify(canon(v ?? {}))).digest("hex");

export async function planFor(ctx: Ctx, text: string): Promise<Plan> {
  const rules = rulePlan(text, ctx.lang, +todayISO().slice(5, 7) - 1);
  if (rules.kind === "reply" && rules.refusal) return rules; // refusals never reach a model
  const llm = await llmPlan(text, toolsFor(ctx).map((t) => ({ name: t.name, description: t.description, params: t.params })));
  return llm ?? rules;
}

/** Answer a question by running one registered tool. Write tools only return a preview and a confirmation token. */
export async function ask(ctx: Ctx, raw: string): Promise<AiReply> {
  const text = raw.trim().slice(0, 500);
  if (!text) throw new UserError("Type a question.");
  const plan = await planFor(ctx, text);
  if (plan.kind === "reply") return { text: plan.text, refused: plan.refusal };

  const tool = toolFor(plan.tool);
  if (!tool) return { text: "I can’t do that yet." };
  if (!toolsFor(ctx).includes(tool)) {
    await writeAudit(db, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: "AI request refused", entity: "ai", entityId: tool.name, detail: `${tool.kind === "write" ? "Action" : "Data"} not allowed for role ${ctx.role} (asked in chat)` });
    return { tool: tool.name, refused: true, text: tool.kind === "write" ? `Your role (${ctx.role}) can’t confirm AI actions. Ask a manager or the owner.` : `Your role (${ctx.role}) doesn’t have access to this information.` };
  }
  const parsed = tool.input.safeParse(plan.input);
  if (!parsed.success) return { text: "I didn’t understand that. Try rephrasing, or pick one of the suggestions." };

  if (tool.kind === "read") return { tool: tool.name, ...(await tool.run(ctx, parsed.data as never)) };

  const pv = await tool.preview!(ctx, parsed.data as never);
  const input = tool.input.parse({ ...(parsed.data as Record<string, unknown>), ...(pv.bound ?? {}) }) as Prisma.InputJsonValue;
  const token = randomBytes(18).toString("base64url");
  const expiresAt = new Date(Date.now() + CONFIRM_MS);
  await db.aiConfirmation.create({ data: { token, tenantId: ctx.tenantId, userId: ctx.userId, tool: tool.name, inputHash: hashInput(input), input, preview: { summary: pv.summary }, expiresAt } });
  return { tool: tool.name, text: pv.text, rows: pv.rows, basis: pv.basis, confirm: { token, label: tool.name === "create_draft_purchase_order" ? "Create draft PO" : "Confirm", expiresAt: expiresAt.toISOString() } };
}

/** Execute a previewed write. The token is single-use, expires in 5 minutes and is bound to the user, tool and input. */
export async function confirm(ctx: Ctx, token: string): Promise<AiReply> {
  const c = await db.aiConfirmation.findUnique({ where: { token } });
  if (!c || c.tenantId !== ctx.tenantId || c.userId !== ctx.userId) throw new UserError("This confirmation isn’t valid. Ask again.");
  if (c.usedAt) throw new UserError("This action was already confirmed or cancelled.");
  if (c.expiresAt < new Date()) throw new UserError("This confirmation expired after 5 minutes. Ask again to see a fresh preview.");
  const tool = toolFor(c.tool);
  if (!tool || tool.kind !== "write") throw new UserError("This confirmation isn’t valid. Ask again.");
  if (!can(ctx, "aiAct") || !tool.perms.every((p) => can(ctx, p))) throw new UserError(`Your role (${ctx.role}) can’t confirm AI actions.`);
  if (hashInput(c.input) !== c.inputHash) throw new UserError("This confirmation was altered. Ask again.");
  const input = tool.input.parse(c.input);

  // Claim the token atomically so a double click can't run the action twice.
  const claimed = await db.aiConfirmation.updateMany({ where: { token, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
  if (claimed.count !== 1) throw new UserError("This action was already confirmed or cancelled.");

  const r = await tool.run(ctx, input as never);
  await writeAudit(db, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: "AI action confirmed", entity: "ai", entityId: c.tool, detail: `${(c.preview as { summary?: string })?.summary ?? ""} · confirmed in chat` });
  return { tool: tool.name, ...r };
}

export async function cancel(ctx: Ctx, token: string) {
  await db.aiConfirmation.updateMany({ where: { token, tenantId: ctx.tenantId, userId: ctx.userId, usedAt: null }, data: { usedAt: new Date() } });
}

/** Mode shown in the drawer footer. */
export const aiMode = () => (process.env.LOCAL_LLM_URL && process.env.LOCAL_LLM_MODEL ? "llm" : "rules") as "llm" | "rules";
