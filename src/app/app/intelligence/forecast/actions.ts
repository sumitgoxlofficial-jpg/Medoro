"use server";
import { revalidatePath } from "next/cache";
import { run } from "@/server/action";
import { draftForecastOrders } from "@/domain/intelligence/forecast-intel";

/** Drafts (never places) purchase orders from this branch's forecast recommendations. */
export async function draftForecastAction(fallbackSupplierId: string | null, includeLow: boolean) {
  const r = await run((c) => draftForecastOrders(c, null, fallbackSupplierId, includeLow));
  revalidatePath("/app/purchases");
  return r;
}
