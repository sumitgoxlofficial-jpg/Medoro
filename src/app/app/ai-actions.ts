"use server";
import { revalidatePath } from "next/cache";
import { run } from "@/server/action";
import { ask, cancel, confirm } from "@/domain/ai/service";
import { requireAiEnabled, saveAiSettings, type AiSettings } from "@/domain/ai/settings";

export async function aiAsk(text: string) {
  return run((ctx) => ask(ctx, String(text ?? "")));
}

export async function aiConfirm(token: string) {
  const r = await run((ctx) => confirm(ctx, String(token ?? "")));
  if (r.ok) revalidatePath("/app", "layout");
  return r;
}

export async function aiCancel(token: string) {
  return run(async (ctx) => { await requireAiEnabled(ctx); return cancel(ctx, String(token ?? "")); });
}

export async function aiSettingsAction(patch: Partial<AiSettings>) {
  const p = patch ?? {};
  const r = await run((ctx) => saveAiSettings(ctx, { ...(typeof p.enabled === "boolean" ? { enabled: p.enabled } : {}), ...(typeof p.remoteNames === "boolean" ? { remoteNames: p.remoteNames } : {}) }));
  if (r.ok) revalidatePath("/app", "layout");
  return r;
}
