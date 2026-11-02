"use server";
import { revalidatePath } from "next/cache";
import { run } from "@/server/action";
import { allocateBill, rejectBillSuggestion, unallocateBill } from "@/domain/finance/bills";

const fresh = <T,>(r: T) => { revalidatePath("/app", "layout"); return r; };
export async function approveBillAction(bankLineId: string, saleId: string) { return fresh(await run((c) => allocateBill(c, { bankLineId, saleId }), "Matched. The receipt is posted.")); }
export async function manualBillAction(bankLineId: string, saleId: string, amountPaise: number) { return fresh(await run((c) => allocateBill(c, { bankLineId, saleId, amountPaise }), "Matched. The receipt is posted.")); }
export async function rejectBillAction(bankLineId: string, saleId: string) { return fresh(await run((c) => rejectBillSuggestion(c, bankLineId, saleId), "Won’t be suggested again.")); }
export async function undoBillAction(allocationId: string) { return fresh(await run((c) => unallocateBill(c, allocationId), "Match undone. The receipt is reversed.")); }
