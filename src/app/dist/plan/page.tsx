import { Check, Lock } from "lucide-react";
import { requireDistCtx, distView } from "@/domain/distribution/context";
import { planView as distPlanView } from "@/domain/distribution/admin";
import { DIST_PLANS, type DistFeature } from "@/domain/distribution/plans";
import { checkIn, planView } from "@/domain/system/licence";
import { billingState, onlinePayments, razorpayEnabled } from "@/domain/system/razorpay";
import { DIST_PAY } from "@/lib/pay-catalog";
import { db } from "@/server/db";
import { PlanView } from "@/app/app/plan/view";
import { PageHead, Panel } from "../_ui/ui";

export const metadata = { title: "Subscription" };

/** Subscription for MEDORO Distribution: the same screen, payments, licence and invoices as MEDORO Pharmacy, with the distribution plans. */
export default async function Page() {
  const ctx = await requireDistCtx();
  distView(ctx, "users");
  if (!ctx.readOnly) await checkIn(ctx.tenantId, { minAgeMs: 10 * 60_000, timeoutMs: 4000 });
  const [d, v, tenant, online, billing] = await Promise.all([
    distPlanView(ctx),
    planView(ctx.tenantId),
    db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { code: true } }),
    onlinePayments(ctx.tenantId),
    billingState(ctx.tenantId),
  ]);
  const pay = { upi: process.env.PAYMENT_UPI_ID?.trim() || null, payee: process.env.PAYMENT_PAYEE?.trim() || "Medoro", bank: process.env.PAYMENT_BANK?.trim() || null };
  const { ent, used } = d;
  const lim = (n: number) => (Number.isFinite(n) ? ` / ${n.toLocaleString("en-IN")}` : " (no limit)");
  const over = (u: number, n: number) => Number.isFinite(n) && u > n;
  const note = ent.open === "trial" ? "Your free trial includes every feature. When it ends, you keep what your chosen plan includes."
    : ent.open === "unlicensed" ? "This copy runs without a licence, so every feature is open."
    : ent.open === "pending" ? "Your plan hasn’t been confirmed yet, so every feature is open for now." : undefined;
  // The cheapest plan that unlocks a feature this plan lacks.
  const unlocks = (f: DistFeature) => Object.values(DIST_PLANS).find((p) => p.features.includes(f))?.name;
  return (
    <>
      <PageHead title="Subscription" sub="Plan, payments, licence and Medoro invoices" />
      <Panel title={ent.plan ? `What your ${DIST_PLANS[ent.plan].name} plan includes` : "What your plan includes"} sub={note} className="mb-4">
        <div className="grid gap-x-8 gap-y-3 min-[800px]:grid-cols-2">
          <ul className="m-0 p-0 list-none flex flex-col gap-2">
            {Object.entries(d.features).map(([f, label]) => {
              const on = ent.features.includes(f as DistFeature);
              return (
                <li key={f} className="flex items-start gap-2.5 text-[13.5px]">
                  {on ? <Check size={15} aria-hidden className="text-ok mt-0.5 flex-none" /> : <Lock size={14} aria-hidden className="text-faint mt-[3px] flex-none" />}
                  <span className={on ? "" : "text-muted"}>{label}{on ? "" : <span className="text-faint"> · {unlocks(f as DistFeature)} plan</span>}</span>
                </li>
              );
            })}
          </ul>
          <div>
            {([["Godowns", used.godowns, ent.limits.godowns], ["Users", used.users, ent.limits.users], ["Chemists", used.chemists, ent.limits.chemists]] as const).map(([label, u, n]) => (
              <div key={label} className="flex justify-between gap-3 py-2 border-b border-row last:border-0 text-[13.5px]">
                <span className="text-muted">{label}</span>
                <span className={"tnum font-medium" + (over(u, n) ? " text-bad" : "")} title={over(u, n) ? "Above your plan’s limit. Existing ones keep working; you can’t add more." : undefined}>{u.toLocaleString("en-IN")}{lim(n)}</span>
              </div>
            ))}
          </div>
        </div>
      </Panel>
      <PlanView
        v={v}
        items={DIST_PAY}
        rows={[["Godowns", String(used.godowns)], ["Active users", String(used.users)], ["Chemists", used.chemists.toLocaleString("en-IN")], ["Backups", "Included"]]}
        pay={pay}
        reference={v.customerCode ?? tenant.code}
        online={{ enabled: razorpayEnabled(), payments: online, billing }}
        payLink={false}
      />
    </>
  );
}
