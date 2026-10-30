"use server";
import { revalidatePath } from "next/cache";
import { run } from "@/server/action";
import { draftFromForecast, draftSeasonal, markReviewed, saveSettings, settings } from "@/domain/intelligence/service";

const fresh = <T,>(r: T) => { revalidatePath("/app", "layout"); return r; };
export async function policyAction(cover: number, safety: number) { return fresh(await run((c) => saveSettings(c, { policy: { cover, safety } }))); }
export async function thresholdsAction(disc: number, refunds: number, cash: number) { return fresh(await run((c) => saveSettings(c, { anomaly: { disc, refunds, cash } }), "Thresholds saved.")); }
export async function draftAction(fallback: string | null) { return fresh(await run(async (c) => draftFromForecast(c, (await settings(c.tenantId)).policy, fallback))); }
export async function reviewAction(key: string, label: string) { return fresh(await run((c) => markReviewed(c, key, label))); }
export async function seasonalPoAction(lines: { medicineId: string; qty: number; rate: number; supplierId: string | null }[], month: string) {
  return fresh(await run((c) => draftSeasonal(c, lines, month)));
}
