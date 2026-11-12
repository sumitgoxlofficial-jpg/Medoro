"use server";
import { revalidatePath } from "next/cache";
import { getCtx } from "@/server/context";
import { run } from "@/server/action";
import { createEstimate, setEstimateStatus, type EstimateInput } from "@/domain/sales/estimate";
import { searchForSale } from "@/domain/sales/service";
import { todayISO } from "@/lib/dates";

const done = <T,>(r: T) => { revalidatePath("/app/estimates"); return r; };

export async function createEstimateAction(input: EstimateInput) { return done(await run((c) => createEstimate(c, input), "Estimate created.")); }
export async function estimateStatusAction(id: string, status: "open" | "billed" | "cancelled") { return done(await run((c) => setEstimateStatus(c, id, status))); }

/** Medicine search for the estimate form: name, salt or barcode, with the price a bill would use now. */
export async function searchEstimateMedsAction(q: string) {
  const ctx = await getCtx();
  if (!ctx || !ctx.perms.includes("sale")) return [];
  const today = todayISO();
  return (await searchForSale(ctx, q)).map((m) => {
    const ok = m.batches.filter((b) => b.status === "ok" && b.expiryDate > today);
    return { id: m.id, name: m.name, strength: m.strength, pack: m.pack, available: ok.reduce((a, b) => a + b.qtyAvailable, 0), mrp: ok[0]?.mrp ?? m.batches[0]?.mrp ?? 0 };
  });
}
