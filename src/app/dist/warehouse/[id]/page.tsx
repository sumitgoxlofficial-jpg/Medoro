import { notFound } from "next/navigation";
import { requireDistCtx, distView } from "@/domain/distribution/context";
import { orderDetail } from "@/domain/distribution/orders";
import { db } from "@/server/db";
import { PageHead } from "../../_ui/ui";
import { Picker } from "../../_ui/picker";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const ctx = await requireDistCtx();
  distView(ctx, "warehouse");
  const { id } = await params;
  const p = await db.distPickList.findFirst({ where: { id, tenantId: ctx.tenantId } });
  if (!p) notFound();
  const o = await orderDetail(ctx, p.orderId);
  if (!o?.pick) notFound();
  return (
    <div className="max-w-[640px]">
      <PageHead title={o.customer} back={{ href: "/dist/warehouse", label: "Pick queue" }} sub={`${o.pick.no} · ${o.no}${o.note ? " · “" + o.note + "”" : ""}`} />
      <Picker pickId={p.id} status={p.status} started={o.status !== "approved" || !!p.pickerId} lines={o.pick.lines.map((l) => ({ id: l.id, rack: l.rack, name: l.name, batchNo: l.batchNo, expiry: l.expiry, units: l.units, packSize: l.packSize, pickedUnits: l.pickedUnits }))} />
    </div>
  );
}
