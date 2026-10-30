"use server";
import { revalidatePath } from "next/cache";
import { run } from "@/server/action";
import { enforce, userKey } from "@/server/ratelimit";
import { draftCampaign, saveCrm, sendCampaign } from "@/domain/comms/crm";

const fresh = <T,>(r: T) => { revalidatePath("/app", "layout"); return r; };
export async function crmAction(p: { refill?: boolean; feedback?: boolean }) { return fresh(await run((c) => saveCrm(c, p))); }
export async function draftAction(name: string, tpl: string) { return fresh(await run((c) => draftCampaign(c, name, tpl), "Campaign saved as draft. Only opted-in customers will receive it.")); }
export async function sendAction(id: string) { return fresh(await run(async (c) => { await enforce("campaign", userKey(c)); return sendCampaign(c, id); })); }
