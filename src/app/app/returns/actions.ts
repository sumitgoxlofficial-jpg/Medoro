"use server";
import { revalidatePath } from "next/cache";
import { getCtx } from "@/server/context";
import { run, UserError } from "@/server/action";
import { MAX_BYTES, MAX_LABEL, sniff } from "@/server/storage";
import { attachSaleRx } from "@/domain/sales/rx";
import { closeShift, openShift, processReturn, recentInvoices, returnableLines, type ReturnInput } from "@/domain/sales/returns";
import { voidSale } from "@/domain/sales/void";
import { sendCreditNote } from "@/domain/comms/whatsapp";

const fresh = <T,>(r: T) => { revalidatePath("/app", "layout"); return r; };
export async function findInvoicesAction(q: string) { const c = await getCtx(); return c ? recentInvoices(c, q) : []; }
export async function linesAction(id: string) { const c = await getCtx(); return c ? returnableLines(c, id) : null; }
export async function returnAction(input: ReturnInput) { return fresh(await run((c) => processReturn(c, input))); }
export async function voidAction(saleId: string, reason: string) { return fresh(await run((c) => voidSale(c, saleId, reason))); }
export async function openShiftAction(opening: string) { return fresh(await run((c) => openShift(c, opening), "Shift opened.")); }
export async function closeShiftAction(counted: string) { return fresh(await run((c) => closeShift(c, counted))); }
export async function sendCreditNoteAction(id: string, phone: string, consent: boolean) { return fresh(await run((c) => sendCreditNote(c, id, phone, consent))); }

/** Attach (or replace) the prescription photo or PDF of a counter bill. */
export async function uploadSaleRxAction(saleId: string, form: FormData) {
  return fresh(await run(async (ctx) => {
    const f = form.get("file");
    if (!(f instanceof File)) throw new UserError("Choose a file.");
    if (f.size > MAX_BYTES) throw new UserError(`File is larger than ${MAX_LABEL}.`);
    const bytes = Buffer.from(await f.arrayBuffer());
    const mime = sniff(bytes);
    if (!mime) throw new UserError("Upload a photo (JPG, PNG, WebP) or PDF of the prescription.");
    await attachSaleRx(ctx, saleId, bytes, mime);
  }, "Prescription attached."));
}
