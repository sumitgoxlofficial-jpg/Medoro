"use server";
import { revalidatePath } from "next/cache";
import { run } from "@/server/action";
import { recordExpense, reverseVoucher, type expenseSchema } from "@/domain/accounting/service";
import type { z } from "zod";

const fresh = <T,>(r: T) => { revalidatePath("/app", "layout"); return r; };
export async function expenseAction(input: z.input<typeof expenseSchema>) { return fresh(await run(async (c) => recordExpense(c, input))); }
export async function reverseAction(id: string, reason: string) { return fresh(await run(async (c) => reverseVoucher(c, id, reason))); }
