"use server";
import { revalidatePath } from "next/cache";
import { run } from "@/server/action";
import { createMedicine, receiveBatch, setQuarantine, updateMedicine } from "@/domain/inventory/service";
import { adjustStock, approveTransfer, cancelTransfer, receiveTransfer, rejectTransfer, requestTransfer, returnToSupplier, writeOff } from "@/domain/inventory/adjust";
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
export async function adjustAction(batchId: string, delta: number, reason: string) {
  return done(await run((ctx) => adjustStock(ctx, batchId, delta, reason)));
}
export async function writeOffAction(batchId: string, qty: number, reason: string) {
  return done(await run(async (ctx) => writeOff(ctx, batchId, qty, reason)));
}
export async function returnAction(batchId: string, qty: number, reason: string) {
  return done(await run(async (ctx) => returnToSupplier(ctx, batchId, qty, reason)));
}
export async function requestTransferAction(batchId: string, to: string, qty: number, note: string) {
  return done(await run(async (ctx) => requestTransfer(ctx, batchId, to, qty, note)));
}
export async function transferAction(id: string, a: "approve" | "reject" | "receive" | "cancel") {
  if (a === "receive") {
    const r = await run((c) => receiveTransfer(c, id));
    return done(r.ok ? { ...r, message: r.data ?? "Received. Stock added at this branch." } : r);
  }
  return done(await run((c) => (a === "approve" ? approveTransfer(c, id) : a === "reject" ? rejectTransfer(c, id) : cancelTransfer(c, id)), a === "approve" ? "Approved. Stock is in transit." : a === "reject" ? "Transfer rejected." : "Transfer cancelled. Stock is back at the sending branch."));
}