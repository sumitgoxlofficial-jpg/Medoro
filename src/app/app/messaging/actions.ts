"use server";
import { revalidatePath } from "next/cache";
import { run } from "@/server/action";
import { draftCampaign, saveCrm, saveSmsSettings, sendCampaign, sendPaymentRemindersNow, sendRefillsNow, type CrmSettings } from "@/domain/comms/crm";
import { saveLoyaltySettings, type LoyaltySettings } from "@/domain/sales/loyalty";
import type { SmsType } from "@/server/sms";

const fresh = <T,>(r: T) => { revalidatePath("/app", "layout"); return r; };
export async function crmAction(p: Partial<CrmSettings>) { return fresh(await run((c) => saveCrm(c, p))); }
export async function draftAction(name: string, tpl: string, message?: string) { return fresh(await run((c) => draftCampaign(c, name, tpl, message), "Saved as draft. Only customers who consented will receive it.")); }
export async function sendAction(id: string) { return fresh(await run(async (c) => sendCampaign(c, id))); }
export async function sendRefillsAction() { return fresh(await run((c) => sendRefillsNow(c))); }
export async function sendPaymentsAction(ids?: string[]) { return fresh(await run((c) => sendPaymentRemindersNow(c, ids))); }
export async function smsAction(p: { enabled?: boolean; templates?: Partial<Record<SmsType, string>> }) { return fresh(await run((c) => saveSmsSettings(c, p), "SMS settings saved.")); }
export async function loyaltyAction(p: Partial<LoyaltySettings>) { return fresh(await run((c) => saveLoyaltySettings(c, p), "Loyalty settings saved.")); }
