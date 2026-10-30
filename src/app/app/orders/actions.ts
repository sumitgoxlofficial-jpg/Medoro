"use server";
import { revalidatePath } from "next/cache";
import { getCtx } from "@/server/context";
import { run, UserError } from "@/server/action";
import { MAX_BYTES, MAX_LABEL, sniff } from "@/server/storage";
import { searchForSale } from "@/domain/sales/service";
import { todayISO } from "@/lib/dates";
import {
  attachRx, cancelOrder, confirmOrder, createOrder, deliverOrder, dispatchOrder, packOrder, reassignRider, returnOrder, settleRider,
} from "@/domain/orders/service";
import type { DeliverInput, OrderInput } from "@/domain/orders/contracts";
import { saveOrderSettings, type NotifyEvent } from "@/domain/orders/notify";

const fresh = <T,>(r: T) => { revalidatePath("/app", "layout"); return r; };
const CHANNEL = { whatsapp: "Customer told on WhatsApp.", sms: "Customer told by SMS.", none: "No message sent (no WhatsApp template or SMS gateway)." };

export async function searchMedsAction(q: string) {
  const ctx = await getCtx();
  if (!ctx || !ctx.perms.includes("sale")) return [];
  const today = todayISO();
  return (await searchForSale(ctx, q)).map((m) => {
    const ok = m.batches.filter((b) => b.status === "ok" && b.expiryDate > today);
    return { id: m.id, name: m.name, strength: m.strength, pack: m.pack, schedule: m.schedule, available: ok.reduce((a, b) => a + b.qtyAvailable, 0), mrp: ok[0]?.mrp ?? m.batches[0]?.mrp ?? 0 };
  });
}

export async function createOrderAction(input: OrderInput) { return fresh(await run((c) => createOrder(c, input))); }
export async function confirmAction(id: string) {
  return fresh(await run(async (c) => { const r = await confirmOrder(c, id); return { ...r, text: `Confirmed. ${CHANNEL[r.channel]}${r.short.length ? ` Short now: ${r.short.join(", ")}.` : ""}` }; }));
}
export async function packAction(id: string) { return fresh(await run(async (c) => { const s = await packOrder(c, id); return s; })); }
export async function dispatchAction(id: string, riderId: string) {
  return fresh(await run(async (c) => { const r = await dispatchOrder(c, id, riderId); return `Out for delivery with ${r.rider}. ${CHANNEL[r.channel]}${r.channel === "none" ? " The rider will record who received it." : " It includes the delivery code."}`; }));
}
export async function reassignAction(id: string, riderId: string) { return fresh(await run((c) => reassignRider(c, id, riderId), "Rider changed.")); }
export async function cancelAction(id: string, reason: string) { return fresh(await run((c) => cancelOrder(c, id, reason))); }
export async function returnAction(id: string, reason: string) { return fresh(await run((c) => returnOrder(c, id, reason))); }
export async function deliverAction(id: string, input: DeliverInput) { return fresh(await run((c) => deliverOrder(c, id, input), "Marked delivered.")); }
export async function settleAction(riderId: string, counted: string, note: string) { return fresh(await run((c) => settleRider(c, riderId, counted, note))); }

export async function uploadRxAction(id: string, form: FormData) {
  return fresh(await run(async (ctx) => {
    const f = form.get("file");
    if (!(f instanceof File)) throw new UserError("Choose a file.");
    if (f.size > MAX_BYTES) throw new UserError(`File is larger than ${MAX_LABEL}.`);
    const bytes = Buffer.from(await f.arrayBuffer());
    const mime = sniff(bytes);
    if (!mime) throw new UserError("Upload a photo (JPG, PNG, WebP) or PDF of the prescription.");
    await attachRx(ctx, id, bytes, mime);
  }, "Prescription attached."));
}

export async function saveTemplatesAction(t: Partial<Record<NotifyEvent, string>>) { return fresh(await run((c) => saveOrderSettings(c, t), "Message templates saved.")); }
