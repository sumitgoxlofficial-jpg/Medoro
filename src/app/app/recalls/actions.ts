"use server";
import { revalidatePath } from "next/cache";
import { run } from "@/server/action";
import { addRecall, quarantineRecall, returnRecalled, setRecallStatus, type recallSchema, type RECALL_STATUS } from "@/domain/inventory/recalls";
import type { z } from "zod";

const fresh = <T,>(r: T) => { revalidatePath("/app", "layout"); return r; };
export async function addRecallAction(input: z.input<typeof recallSchema>) { return fresh(await run(async (c) => addRecall(c, input))); }
export async function quarantineRecallAction(id: string) { return fresh(await run(async (c) => quarantineRecall(c, id))); }
export async function recallStatusAction(id: string, s: (typeof RECALL_STATUS)[number]) { return fresh(await run((c) => setRecallStatus(c, id, s), "Status updated.")); }
export async function returnRecallAction(id: string) { return fresh(await run(async (c) => returnRecalled(c, id))); }
