import { redirect } from "next/navigation";
import { requireCtx, can } from "@/server/context";
import { db } from "@/server/db";
import { PageHead } from "@/components/page-head";
import { t } from "@/lib/i18n";
import { checkIn, planView } from "@/domain/system/licence";
import { onlinePayments, razorpayEnabled } from "@/domain/system/razorpay";
import { PlanView } from "./view";

export const metadata = { title: "Subscription" };

export default async function Page() {
  const ctx = await requireCtx();
  if (!can(ctx, "users")) redirect("/app");
  if (!ctx.readOnly) await checkIn(ctx.tenantId, { minAgeMs: 10 * 60_000, timeoutMs: 4000 });
  const [v, tenant, branches, counters, users, online] = await Promise.all([
    planView(ctx.tenantId),
    db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { code: true } }),
    db.branch.count({ where: { tenantId: ctx.tenantId, active: true } }),
    db.counter.count({ where: { tenantId: ctx.tenantId, active: true } }),
    db.user.count({ where: { tenantId: ctx.tenantId, active: true, isSupport: false } }),
    onlinePayments(ctx.tenantId),
  ]);
  const pay = { upi: process.env.PAYMENT_UPI_ID?.trim() || null, payee: process.env.PAYMENT_PAYEE?.trim() || "Medoro", bank: process.env.PAYMENT_BANK?.trim() || null };
  return (
    <>
      <PageHead title={t(ctx.lang).plan} sub="Plan, payments, licence and Medoro invoices" />
      <PlanView v={v} usage={{ branches, counters, users }} pay={pay} reference={v.customerCode ?? tenant.code} online={{ enabled: razorpayEnabled(), payments: online }} />
    </>
  );
}
