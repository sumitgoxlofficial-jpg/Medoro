import { redirect } from "next/navigation";
import { requireCtx, can } from "@/server/context";
import { db } from "@/server/db";
import { listHeld, posCustomers } from "@/domain/sales/service";
import { discountCap } from "@/domain/identity/permissions";
import { PageHead } from "@/components/page-head";
import { t } from "@/lib/i18n";
import { listDoctors } from "@/domain/doctors/service";
import { Pos } from "./pos";

export const metadata = { title: "Billing" };

export default async function Page() {
  const ctx = await requireCtx();
  if (!can(ctx, "sale")) redirect("/app");
  const [customers, held, wa, doctors] = await Promise.all([
    posCustomers(ctx), listHeld(ctx), db.integration.findUnique({ where: { tenantId_kind: { tenantId: ctx.tenantId, kind: "whatsapp" } } }), listDoctors(ctx),
  ]);
  const d = t(ctx.lang);
  return (
    <>
      <PageHead title={d.pos} sub={`${ctx.counterName ?? "Browser counter"} · ${ctx.branchName} · F2 search · F4 hold · F9 complete`} />
      <Pos
        dict={{ search: d.search, cart: d.cart, customer: d.customer, payment: d.payment, total: d.total, complete: d.complete, hold: d.hold }}
        customers={customers} held={held.map((h) => ({ id: h.id, label: h.label }))}
        canCredit={can(ctx, "credit")} discCap={discountCap(ctx.perms)} role={ctx.role}
        storageKey={`medoro_cart_${ctx.branchId}_${ctx.counterId ?? ctx.userId}`} waConnected={!!wa?.connectedAt} doctors={doctors}
      />
    </>
  );
}
