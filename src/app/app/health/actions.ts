"use server";
import { revalidatePath } from "next/cache";
import { run } from "@/server/action";
import { runHealthTest } from "@/domain/system/health";

/** Runs one explicit integration test (or re-reads a live check) and refreshes the screen. */
export async function testAction(key: string) {
  const r = await run((c) => runHealthTest(c, key));
  revalidatePath("/app/health");
  return r;
}
