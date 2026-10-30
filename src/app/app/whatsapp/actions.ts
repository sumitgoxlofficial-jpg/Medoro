"use server";
import { revalidatePath } from "next/cache";
import { run } from "@/server/action";
import { connectWhatsApp, disconnectWhatsApp, saveWaSettings, sendInvoice, syncTemplates, type connectSchema } from "@/domain/comms/whatsapp";
import { campaignRef, retryCampaignMessage } from "@/domain/comms/crm";
import { db } from "@/server/db";
import type { z } from "zod";

const fresh = <T,>(r: T) => { revalidatePath("/app", "layout"); return r; };
export async function connectAction(i: z.input<typeof connectSchema>) { return fresh(await run(async (c) => { await connectWhatsApp(c, i); }, "WhatsApp connected. Add the webhook in your Meta app to get delivery updates.")); }
export async function disconnectAction() { return fresh(await run((c) => disconnectWhatsApp(c), "Disconnected. The token was deleted from this server.")); }
export async function templatesAction() { return fresh(await run(async (c) => syncTemplates(c))); }
export async function autoAction(auto: boolean) { return fresh(await run((c) => saveWaSettings(c, { auto }), auto ? "Auto-send on for opted-in customers." : "Auto-send off.")); }
export async function retryAction(id: string) {
  return fresh(await run(async (c) => {
    const m = await db.waMessage.findFirstOrThrow({ where: { id, tenantId: c.tenantId } });
    return m.invoiceId.startsWith(campaignRef("")) ? retryCampaignMessage(c, m.id) : sendInvoice(c, m.invoiceId, m.recipient, true);
  }, "Retry sent."));
}
