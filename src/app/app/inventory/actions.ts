"use server";
import { revalidatePath } from "next/cache";
import { run } from "@/server/action";
import { createMedicine, receiveBatch, setQuarantine, updateMedicine } from "@/domain/inventory/service";
import { adjustStock, approveTransfer, cancelTransfer, receiveTransfer, rejectTransfer, requestTransfer, returnToSupplier, writeOff } from "@/domain/inventory/adjust";
import type { MedicineInput, ReceiveInput } from "@/domain/inventory/contracts";
import { assignInternalBarcodes, importSampleSalts, rebuildSaltKeys, setBranchRack } from "@/domain/inventory/catalog";

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
export async function setRackAction(medicineId: string, rack: string) {
  return done(await run((ctx) => setBranchRack(ctx, medicineId, rack), rack.trim() ? "Rack saved for this branch." : "Branch rack cleared."));
}
export async function sampleSaltsAction() {
  const r = await run((ctx) => importSampleSalts(ctx));
  return done(r.ok ? { ...r, message: `Sample salts imported: ${r.data.created} medicines added, ${r.data.enriched} given a composition.` } : r);
}
export async function rebuildSaltsAction() {
  const r = await run((ctx) => rebuildSaltKeys(ctx));
  return done(r.ok ? { ...r, message: `Composition keys rebuilt: ${r.data.changed} of ${r.data.total} medicines updated.` } : r);
}
/** Gives the selected medicines an internal barcode where they have none, so every label can be scanned at the counter. */
export async function prepareLabelsAction(medicineIds: string[]) {
  return done(await run((ctx) => assignInternalBarcodes(ctx, medicineIds.slice(0, 500))));
}
