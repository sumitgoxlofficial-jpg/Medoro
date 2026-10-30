"use server";
import { revalidatePath } from "next/cache";
import { run } from "@/server/action";
import { deliverOrder, failedAttempt } from "@/domain/orders/service";
import type { DeliverInput } from "@/domain/orders/contracts";

const fresh = <T,>(r: T) => { revalidatePath("/app", "layout"); return r; };
export async function deliveredAction(id: string, input: DeliverInput) { return fresh(await run((c) => deliverOrder(c, id, input), "Delivered. Thank you!")); }
export async function failedAction(id: string, reason: string) { return fresh(await run((c) => failedAttempt(c, id, reason), "Noted. The store can see it now.")); }
