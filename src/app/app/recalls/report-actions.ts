"use server";
import { revalidatePath } from "next/cache";
import { run } from "@/server/action";
import { DISPOSAL_METHODS, disposeRecalled } from "@/domain/inventory/recall-report";
import { saveRecallSettings, setRecallStatus } from "@/domain/inventory/recalls";

const fresh = <T,>(r: T) => { revalidatePath("/app/recalls", "layout"); return r; };
export async function disposeAction(recallId: string, batchId: string, qty: number, method: (typeof DISPOSAL_METHODS)[number], reference: string, note: string) {
  return fresh(await run((c) => disposeRecalled(c, recallId, batchId, qty, method, reference, note), "Disposal recorded."));
}
export async function resolveAction(id: string, note: string) { return fresh(await run((c) => setRecallStatus(c, id, "resolved", note), "Recall resolved.")); }
export async function reopenAction(id: string) { return fresh(await run((c) => setRecallStatus(c, id, "investigating"), "Recall reopened.")); }
export async function autoQuarantineAction(on: boolean) { return fresh(await run((c) => saveRecallSettings(c, { autoQuarantine: on }), "Saved.")); }
