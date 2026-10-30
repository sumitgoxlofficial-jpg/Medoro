"use server";
import { revalidatePath } from "next/cache";
import { run } from "@/server/action";
import { cancelIrn, generateIrn, generateSaleEwb, generateTransferEwb, saveGstSettings } from "@/domain/gst/service";
import type { CANCEL_REASONS, TransportInput } from "@/domain/gst/contracts";
import type { TallyMap } from "@/domain/gst/tally";

const fresh = <T,>(r: T) => { revalidatePath("/app/accounts"); return r; };
export async function gstSettingsAction(input: { einvoicing?: boolean; tallyCompany?: string; tallyMap?: TallyMap }) { return fresh(await run((c) => saveGstSettings(c, input), "GST settings saved.")); }
export async function irnAction(saleId: string) { return fresh(await run((c) => generateIrn(c, saleId))); }
export async function cancelIrnAction(saleId: string, reason: keyof typeof CANCEL_REASONS, remark: string) { return fresh(await run((c) => cancelIrn(c, saleId, reason, remark), "IRN cancelled.")); }
export async function saleEwbAction(saleId: string, t: TransportInput) { return fresh(await run((c) => generateSaleEwb(c, saleId, t))); }
export async function transferEwbAction(transferId: string, t: TransportInput) { return fresh(await run((c) => generateTransferEwb(c, transferId, t))); }
