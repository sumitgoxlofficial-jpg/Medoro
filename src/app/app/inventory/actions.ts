"use server";
import { revalidatePath } from "next/cache";
import { run } from "@/server/action";
import { createMedicine, receiveBatch, setQuarantine, updateMedicine } from "@/domain/inventory/service";
import type { MedicineInput, ReceiveInput } from "@/domain/inventory/contracts";

const done = <T,>(r: T) => { revalidatePath("/app", "layout"); return r; };

export async function addMedicineAction(input: MedicineInput) {
  return done(await run((ctx) => createMedicine(ctx, input), "Medicine added. Receive a batch to make it sellable."));
}
export async function editMedicineAction(id: string, version: number, input: MedicineInput) {
  return done(await run((ctx) => updateMedicine(ctx, id, version, input), "Medicine updated."));
}
export async function receiveBatchAction(input: ReceiveInput) {
  return done(await run(async (ctx) => receiveBatch(ctx, input)));
}
export async function quarantineAction(batchId: string, quarantine: boolean, note: string) {
  return done(await run((ctx) => setQuarantine(ctx, batchId, quarantine, note), quarantine ? "Batch quarantined. It is blocked from sale." : "Batch released for sale."));
}
