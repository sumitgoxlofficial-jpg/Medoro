"use server";
import { revalidatePath } from "next/cache";
import { run } from "@/server/action";
import { addFromCatalogue, applyCatalogue, linkMedicine, markCatalogueReviewed, requestCorrection, unlinkMedicine } from "@/domain/inventory/catalogue-sync";
import type { SyncField } from "@/domain/inventory/catalogue-rules";

const fresh = <T,>(r: T) => { revalidatePath("/app/inventory", "layout"); return r; };
export async function linkAction(medicineId: string, gid: string) { return fresh(await run((c) => linkMedicine(c, medicineId, gid), "Linked. Nothing about the medicine was changed.")); }
export async function unlinkAction(medicineId: string) { return fresh(await run((c) => unlinkMedicine(c, medicineId), "Unlinked.")); }
export async function applyAction(medicineId: string, fields: SyncField[]) { return fresh(await run((c) => applyCatalogue(c, medicineId, fields), "Updated from the catalogue.")); }
export async function addAction(gid: string, mrp: string) { return fresh(await run((c) => addFromCatalogue(c, gid, { mrp }), "Medicine added with your MRP.")); }
export async function correctionAction(input: Parameters<typeof requestCorrection>[1]) { return fresh(await run((c) => requestCorrection(c, input), "Sent to Medoro for review.")); }
export async function reviewedAction() { return fresh(await run((c) => markCatalogueReviewed(c), "Marked as reviewed.")); }
