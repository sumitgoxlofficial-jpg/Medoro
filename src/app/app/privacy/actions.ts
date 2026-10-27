"use server";
import { revalidatePath } from "next/cache";
import { run } from "@/server/action";
import { eraseCustomer, savePrivacy, type Privacy } from "@/domain/system/privacy";

export async function privacyAction(p: Partial<Privacy>) { const r = await run(async (c) => savePrivacy(c, p)); revalidatePath("/app", "layout"); return r; }
export async function eraseAction(id: string) { const r = await run((c) => eraseCustomer(c, id), "Personal details erased. Tax invoices are kept with an anonymised party."); revalidatePath("/app", "layout"); return r; }
