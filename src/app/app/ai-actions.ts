"use server";
import { revalidatePath } from "next/cache";
import { run } from "@/server/action";
import { ask, cancel, confirm } from "@/domain/ai/service";

export async function aiAsk(text: string) {
  return run((ctx) => ask(ctx, String(text ?? "")));
}

export async function aiConfirm(token: string) {
  const r = await run((ctx) => confirm(ctx, String(token ?? "")));
  if (r.ok) revalidatePath("/app", "layout");
  return r;
}

export async function aiCancel(token: string) {
  return run((ctx) => cancel(ctx, String(token ?? "")));
}
