"use server";
import { revalidatePath } from "next/cache";
import { db } from "@/server/db";
import { run, UserError } from "@/server/action";
import { writeAudit } from "@/server/audit";
import { authorize } from "@/server/context";
import { GST_BASES, rulesOf, type PricingRules } from "@/domain/purchasing/pricing";
import { EBILL_MAX_BYTES, parseEbill } from "@/domain/purchasing/ebill-service";

export async function parseEbillAction(form: FormData) {
  return run(async (ctx) => {
    const f = form.get("file"), supplierId = String(form.get("supplierId") ?? "");
    if (!(f instanceof File)) throw new UserError("Choose the bill file.");
    if (f.size > EBILL_MAX_BYTES) throw new UserError("Bill file is larger than 2 MB.");
    const mapping = form.get("mapping");
    let m: unknown = undefined;
    if (typeof mapping === "string" && mapping) { try { m = JSON.parse(mapping); } catch { throw new UserError("Column mapping is invalid."); } }
    return parseEbill(ctx, supplierId, f.name, new Uint8Array(await f.arrayBuffer()), m, form.get("remember") === "1");
  });
}

export async function savePricingRulesAction(rules: PricingRules) {
  const r = await run(async (ctx) => {
    authorize(ctx, "users");
    if (!(GST_BASES as readonly string[]).includes(rules.gstBase) || typeof rules.itc !== "boolean") throw new UserError("Invalid pricing rules.");
    const t = await db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId } });
    const before = rulesOf(t.settings);
    await db.tenant.update({ where: { id: ctx.tenantId }, data: { settings: { ...(t.settings as object), purchasing: { gstBase: rules.gstBase, itc: rules.itc } } } });
    await writeAudit(db, { tenantId: ctx.tenantId, userId: ctx.userId, userName: ctx.userName, action: "Purchase pricing rules changed", entity: "tenant", before, after: rules, detail: `GST on ${rules.gstBase} · input GST ${rules.itc ? "claimed" : "added to cost"}` });
  }, "Saved. New GRNs use these rules; posted GRNs keep theirs.");
  revalidatePath("/app", "layout");
  return r;
}
