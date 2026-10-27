"use server";
import { revalidatePath } from "next/cache";
import { getCtx } from "@/server/context";
import { run } from "@/server/action";
import { closeShift, openShift, processReturn, recentInvoices, returnableLines, type ReturnInput } from "@/domain/sales/returns";

const fresh = <T,>(r: T) => { revalidatePath("/app", "layout"); return r; };
export async function findInvoicesAction(q: string) { const c = await getCtx(); return c ? recentInvoices(c, q) : []; }
export async function linesAction(id: string) { const c = await getCtx(); return c ? returnableLines(c, id) : null; }
export async function returnAction(input: ReturnInput) { return fresh(await run((c) => processReturn(c, input))); }
export async function openShiftAction(opening: string) { return fresh(await run((c) => openShift(c, opening), "Shift opened.")); }
export async function closeShiftAction(counted: string) { return fresh(await run((c) => closeShift(c, counted))); }
