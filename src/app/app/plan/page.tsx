import { CreditCard } from "lucide-react";
import { redirect } from "next/navigation";
import { requireCtx, can, entitlementsOf } from "@/server/context";
import { db } from "@/server/db";
import { PageHead } from "@/components/page-head";
import { t } from "@/lib/i18n";
import { checkIn, planView } from "@/domain/system/licence";
import { billingState, onlinePayments, razorpayEnabled } from "@/domain/system/razorpay";
import { PlanIncludes } from "./includes";
import { PlanView } from "./view";

export const metadata = { title: "Subscription" };

export default async function Page() {
  const ctx = await requireCtx();
  if (!can(ctx, "users")) redirect("/app");
  if (!ctx.readOnly) await checkIn(ctx.tenantId, { minAgeMs: 10 * 60_000, timeoutMs: 4000 });
  const [v, tenant, branches, counters, users, online, billing] = await Promise.all([
    planView(ctx.tenantId),
    db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { code: true } }),
    db.branch.count({ where: { tenantId: ctx.tenantId, active: true } }),
    db.counter.count({ where: { tenantId: ctx.tenantId, active: true } }),
    db.user.count({ where: { tenantId: ctx.tenantId, active: true, isSupport: false } }),
    onlinePayments(ctx.tenantId),
    billingState(ctx.tenantId),
  ]);
  const ent = await entitlementsOf(ctx);
  const pay = { upi: process.env.PAYMENT_UPI_ID?.trim() || null, payee: process.env.PAYMENT_PAYEE?.trim() || "Medoro", bank: process.env.PAYMENT_BANK?.trim() || null };
  return (
    <>
      <PageHead icon={CreditCard} title={t(ctx.lang).plan} sub="Plan, payments, licence and Medoro invoices" />
      <PlanIncludes ent={{ plan: ent.plan, open: ent.open, features: [...ent.features], limits: { branches: Number.isFinite(ent.limits.branches) ? ent.limits.branches : null, counters: Number.isFinite(ent.limits.counters) ? ent.limits.counters : null, users: Number.isFinite(ent.limits.users) ? ent.limits.users : null } }} usage={{ branches, counters, users }} />
      <PlanView v={v} usage={{ branches, counters, users }} pay={pay} reference={v.customerCode ?? tenant.code} online={{ enabled: razorpayEnabled(), payments: online, billing }} />
    </>
  );
}
