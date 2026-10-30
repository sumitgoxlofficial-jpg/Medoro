"use server";
import { revalidatePath } from "next/cache";
import { run } from "@/server/action";
import { postCount } from "@/domain/inventory/adjust";

export async function postCountAction(lines: { batchId: string; counted: number }[], note: string) {
  const r = await run((c) => postCount(c, { lines, note }));
  if (r.ok) revalidatePath("/app", "layout");
  return r;
}
