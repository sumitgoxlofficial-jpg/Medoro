"use server";
import { revalidatePath } from "next/cache";
import { run } from "@/server/action";
import { addDocument, addInspection, closeInspection, saveComplianceSettings, saveItem, setItemActive } from "@/domain/system/compliance";

const fresh = <T,>(r: T) => { revalidatePath("/app/compliance"); revalidatePath("/app", "layout"); return r; };
type ItemInput = Parameters<typeof saveItem>[2];
export async function saveItemAction(id: string | null, input: ItemInput, version?: number) { return fresh(await run((c) => saveItem(c, id, input, version), "Saved.")); }
export async function itemActiveAction(id: string, active: boolean) { return fresh(await run((c) => setItemActive(c, id, active), active ? "Switched on." : "Switched off.")); }
export async function inspectionAction(input: Parameters<typeof addInspection>[1]) { return fresh(await run((c) => addInspection(c, input), "Inspection recorded.")); }
export async function closeInspectionAction(id: string, note: string) { return fresh(await run((c) => closeInspection(c, id, note), "Closed.")); }
export async function settingsAction(input: Parameters<typeof saveComplianceSettings>[1]) { return fresh(await run((c) => saveComplianceSettings(c, input), "Saved.")); }
export async function uploadAction(form: FormData) {
  return fresh(await run(async (c) => {
    const file = form.get("file");
    if (!(file instanceof File)) throw new (await import("@/server/action")).UserError("Choose a file.");
    return addDocument(c, { itemId: (form.get("itemId") as string) || null, inspectionId: (form.get("inspectionId") as string) || null, kind: ((form.get("kind") as string) || "licence_copy") as "licence_copy", title: String(form.get("title") ?? ""), fileName: file.name, bytes: Buffer.from(await file.arrayBuffer()) });
  }, "Document stored."));
}
