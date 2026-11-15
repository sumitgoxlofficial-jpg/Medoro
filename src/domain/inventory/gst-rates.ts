import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { writeAudit } from "@/server/audit";
import { authorizeAny, authorizeView, type Ctx } from "@/server/context";
import { UserError } from "@/server/action";
import { big } from "@/lib/money";
import { GST_RATES } from "./contracts";

/**
 * Bulk GST rate review. Most medicines moved from 12% to 5% on 22 September 2025, but medicines added earlier keep
 * the rate they were saved with. This lists the active medicines at one rate so an owner can move the right ones to
 * another rate in one step. Only new bills use the new rate; past bills keep the rate they were billed at.
 */
export async function medicinesAtRate(ctx: Ctx, rate: number) {
  authorizeView(ctx, "adjust", "purchase");
  const rows = await db.medicine.findMany({
    where: { tenantId: ctx.tenantId, active: true, gstRate: rate },
    select: { id: true, name: true, strength: true, hsn: true, mrpPaise: true },
    orderBy: { name: "asc" },
    take: 5000,
  });
  return rows.map((m) => ({ id: m.id, name: m.name, strength: m.strength, hsn: m.hsn, mrp: big(m.mrpPaise) }));
}

const rate = z.coerce.number().refine((n) => (GST_RATES as readonly number[]).includes(n), "GST should be 0, 5, 12, 18 or 28.");
const changeSchema = z.object({ ids: z.array(z.string().min(1)).min(1, "Select at least one medicine.").max(5000), from: rate, to: rate })
  .refine((v) => v.from !== v.to, "Choose a different rate.");

/** Moves the chosen medicines from one rate to another. Medicines no longer at `from` (changed meanwhile) are left alone. */
export async function changeGstRate(ctx: Ctx, raw: z.input<typeof changeSchema>) {
  authorizeAny(ctx, "adjust", "purchase");
  const p = changeSchema.safeParse(raw);
  if (!p.success) throw new UserError(p.error.issues[0].message);
  const { ids, from, to } = p.data;
  return db.$transaction(async (tx) => {
    const r = await tx.medicine.updateMany({
      where: { tenantId: ctx.tenantId, id: { in: [...new Set(ids)] }, gstRate: from },
      data: { gstRate: to, version: { increment: 1 } },
    });
    if (r.count) {
      await writeAudit(tx, {
        tenantId: ctx.tenantId, branchId: ctx.branchId, userId: ctx.userId, userName: ctx.userName, action: "GST rate changed", entity: "medicine", entityId: null,
        detail: `${r.count} medicine${r.count === 1 ? "" : "s"} · GST ${from}% → ${to}%`, before: { gstRate: from, count: r.count }, after: { gstRate: to, count: r.count },
      });
    }
    return r.count;
  });
}
