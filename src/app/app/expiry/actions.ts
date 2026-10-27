"use server";
import { revalidatePath } from "next/cache";
import { run } from "@/server/action";
import { requestTransfer, returnToSupplier, writeOff } from "@/domain/inventory/adjust";
import { setQuarantine } from "@/domain/inventory/service";

const fresh = <T,>(r: T) => { revalidatePath("/app", "layout"); return r; };
export async function returnAction(batchId: string, qty: number, reason: string) { return fresh(await run(async (c) => returnToSupplier(c, batchId, qty, reason))); }
export async function writeOffAction(batchId: string, qty: number, reason: string) { return fresh(await run(async (c) => writeOff(c, batchId, qty, reason))); }
export async function transferAction(batchId: string, to: string, qty: number) { return fresh(await run(async (c) => requestTransfer(c, batchId, to, qty, "Expiry prevention"))); }
export async function quarantineAction(batchId: string) { return fresh(await run((c) => setQuarantine(c, batchId, true, "Near expiry"), "Batch quarantined.")); }
