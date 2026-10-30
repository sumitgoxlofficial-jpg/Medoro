"use server";
import { revalidatePath } from "next/cache";
import { run } from "@/server/action";
import { bounceCheque, clearCheque, depositCheque, type bounceSchema } from "@/domain/parties/cheques";
import type { z } from "zod";

const fresh = <T,>(r: T) => { revalidatePath("/app", "layout"); return r; };
export async function depositChequeAction(id: string) { return fresh(await run((c) => depositCheque(c, id), "Marked deposited. Mark it cleared when it shows in the bank.")); }
export async function clearChequeAction(id: string, on: string) { return fresh(await run(async (c) => `${await clearCheque(c, id, on)} posted. The bank balance now includes this cheque.`)); }
export async function bounceChequeAction(id: string, input: z.input<typeof bounceSchema>) { return fresh(await run(async (c) => `${await bounceCheque(c, id, input)} posted. The party’s balance is restored.`)); }
