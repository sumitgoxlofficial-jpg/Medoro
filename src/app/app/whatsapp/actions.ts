"use server";
import { revalidatePath } from "next/cache";
import { run } from "@/server/action";
import { completeEmbeddedSignup, connectWhatsApp, disconnectWhatsApp, saveWaSettings, syncTemplates, type connectSchema, type signupSchema, type WaSettings } from "@/domain/comms/whatsapp";
import { retryMessage } from "@/domain/comms/delivery";
import type { z } from "zod";

const fresh = <T,>(r: T) => { revalidatePath("/app", "layout"); return r; };
export async function connectAction(i: z.input<typeof connectSchema>) { return fresh(await run(async (c) => { await connectWhatsApp(c, i); }, "WhatsApp connected. Add the webhook in your Meta app to get delivery updates.")); }
export async function signupAction(i: z.input<typeof signupSchema>) { return fresh(await run(async (c) => (await completeEmbeddedSignup(c, i)).notes)); }
export async function disconnectAction() { return fresh(await run((c) => disconnectWhatsApp(c), "Disconnected. The token was deleted from this server.")); }
export async function templatesAction() { return fresh(await run(async (c) => syncTemplates(c))); }
export async function settingsAction(p: Partial<WaSettings>) { return fresh(await run((c) => saveWaSettings(c, p), "Saved.")); }
export async function retryAction(id: string) { return fresh(await run((c) => retryMessage(c, id), "Retry sent.")); }
