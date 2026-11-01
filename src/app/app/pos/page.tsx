import { redirect } from "next/navigation";
import { requireCtx, can } from "@/server/context";
import { db } from "@/server/db";
import { listHeld, posCustomers } from "@/domain/sales/service";
import { discountCap } from "@/domain/identity/permissions";
import { maxDiscount } from "@/domain/sales/approval";
import { loyaltySettings } from "@/domain/sales/loyalty";
import { PageHead } from "@/components/page-head";
import { t } from "@/lib/i18n";
import { listDoctors } from "@/domain/doctors/service";
import { Pos } from "./pos";
import { driveModeOn } from "@/domain/system/drive-mode";

export const metadata = { title: "Billing" };

export default async function Page() {
  const ctx = await requireCtx();
  if (!can(ctx, "sale")) redirect("/app");
  const [customers, held, wa, maxDisc, doctors, loyalty, driveMode] = await Promise.all([
    posCustomers(ctx), listHeld(ctx), db.integration.findUnique({ where: { tenantId_kind: { tenantId: ctx.tenantId, kind: "whatsapp" } } }), maxDiscount(ctx.tenantId), listDoctors(ctx), loyaltySettings(ctx.tenantId), driveModeOn(ctx.tenantId),
  ]);
  const d = t(ctx.lang);
  return (
    <>
      {driveMode ? <a href="/app/device-pos" className="block mb-3 text-[13px] text-teal bg-teal-tint border border-teal-line rounded-lg px-3 py-2 no-underline">Drive mode is on: bill on this device’s own database →</a> : null}
      <PageHead title={d.pos} sub={<>{ctx.counterName ?? "Browser counter"} · {ctx.branchName}<span className="max-md:hidden"> · F2 search · F4 hold · F9 complete</span></>} />
      <Pos
        dict={{ search: d.search, cart: d.cart, customer: d.customer, payment: d.payment, total: d.total, complete: d.complete, hold: d.hold }}
        customers={customers} held={held.map((h) => ({ id: h.id, label: h.label }))}
        canCredit={can(ctx, "credit")} discCap={discountCap(ctx.perms)} maxDisc={maxDisc} role={ctx.role}
        storageKey={`medoro_cart_${ctx.branchId}_${ctx.counterId ?? ctx.userId}`} waConnected={!!wa?.connectedAt && !(wa.config as { disconnected?: unknown }).disconnected} doctors={doctors}
        loyalty={loyalty.enabled ? { pointValuePaise: loyalty.pointValuePaise, minRedeem: loyalty.minRedeem } : null}
      />
    </>
  );
}
