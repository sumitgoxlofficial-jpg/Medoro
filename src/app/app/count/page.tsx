import { redirect } from "next/navigation";
import { requireCtx, can } from "@/server/context";
import { db } from "@/server/db";
import { big } from "@/lib/money";
import { isoOf } from "@/lib/dates";
import { PageHead } from "@/components/page-head";
import { t } from "@/lib/i18n";
import { CountView } from "./view";

export const metadata = { title: "Stock count" };

export default async function Page() {
  const ctx = await requireCtx();
  if (!can(ctx, "adjust")) redirect("/app");
  const [batches, recent] = await Promise.all([
    db.batch.findMany({ where: { tenantId: ctx.tenantId, branchId: ctx.branchId }, include: { medicine: { select: { name: true, rack: true } } }, orderBy: [{ medicine: { name: "asc" } }, { expiryDate: "asc" }] }),
    db.stockCount.findMany({ where: { tenantId: ctx.tenantId, branchId: ctx.branchId }, orderBy: { at: "desc" }, take: 5 }),
  ]);
  return (
    <>
      <PageHead title={t(ctx.lang).count} sub={`Physical count against system stock · ${ctx.branchName}`} />
      <CountView
        rows={batches.map((b) => ({ id: b.id, name: b.medicine.name, rack: b.medicine.rack, batchNo: b.batchNo, expiry: isoOf(b.expiryDate), system: b.qtyAvailable, cost: big(b.costPaise) }))}
        recent={recent.map((c) => { const l = c.lines as { diff: number; valuePaise: number }[]; return { no: c.no, at: c.at.toISOString(), counted: l.length, changed: l.filter((x) => x.diff).length, value: l.reduce((a, x) => a + x.valuePaise, 0) }; })}
      />
    </>
  );
}
