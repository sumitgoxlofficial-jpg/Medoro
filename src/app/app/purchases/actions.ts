"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/server/db";
import { run, UserError } from "@/server/action";
import { writeAudit } from "@/server/audit";
import { MAX_BYTES, MAX_LABEL, saveDocument, sniff } from "@/server/storage";
import { createPo, postGrnTx, purchaseCatalogue, setPoStatus } from "@/domain/purchasing/service";
import { extractInvoice, matchMedicine, ocrConfigured } from "@/domain/purchasing/ocr";
import type { GrnInput, PoInput } from "@/domain/purchasing/contracts";

const fresh = <T,>(r: T) => { revalidatePath("/app", "layout"); return r; };
export async function createPoAction(input: PoInput) { return fresh(await run((c) => createPo(c, input))); }
export async function poStatusAction(id: string, action: "place" | "cancel") { return fresh(await run((c) => setPoStatus(c, id, action), action === "place" ? "Order placed. Share the PO with your supplier." : "Order cancelled.")); }
export async function postGrnAction(input: GrnInput) { return fresh(await run((c) => postGrnTx(c, input))); }

export async function uploadInvoiceAction(form: FormData) {
  return run(async (ctx) => {
    if (!ctx.perms.includes("purchase")) throw new UserError("Your role cannot receive purchases.");
    const f = form.get("file");
    if (!(f instanceof File)) throw new UserError("Choose a file.");
    if (f.size > MAX_BYTES) throw new UserError(`File is larger than ${MAX_LABEL}.`);
    const bytes = Buffer.from(await f.arrayBuffer());
    const mime = sniff(bytes);
    if (!mime) throw new UserError("Upload a PDF, JPG, PNG or WebP of the invoice.");
    const { sha256, rel } = await saveDocument(ctx.tenantId, bytes, mime);
    let extracted = null, ocrError: string | null = null;
    if (ocrConfigured()) {
      try {
        const r = await extractInvoice(bytes, mime);
        const cat = await purchaseCatalogue(ctx);
        extracted = { ...r, lines: r.lines.map((l) => ({ ...l, medicineId: l.name ? matchMedicine(l.name, cat) : null })) };
      } catch (e) { ocrError = e instanceof Error ? e.message : "OCR failed."; }
    }
    const doc = await db.scanDocument.create({ data: { tenantId: ctx.tenantId, fileName: f.name.slice(0, 120), storagePath: rel, mime, sizeBytes: f.size, sha256, status: "review", extracted: (extracted ?? {}) as object, confidence: {}, createdBy: ctx.userId } });
    await writeAudit(db, { tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: "Invoice uploaded", entity: "scan_document", entityId: doc.id, detail: `${f.name} · ${sha256.slice(0, 12)}` });
    return { id: doc.id, mime, name: f.name, extracted, ocrError };
  });
}
