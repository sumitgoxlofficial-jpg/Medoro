"use client";
import { Check, Lock } from "lucide-react";
import { Card, CardHead } from "@/components/ui/card";
import { useT } from "@/lib/i18n-client";
import { ALL_FEATURES, FEATURES, PLAN_RULES, planFor, type Feature, type PlanId } from "@/lib/plans";

type Plan = { plan: PlanId | null; open: "trial" | "unlicensed" | "pending" | null; features: Feature[]; limits: { branches: number | null; counters: number | null; users: number | null } };

/** What the current plan includes: features (with the plan that unlocks the rest) and limits against what is in use. */
export function PlanIncludes({ ent, usage }: { ent: Plan; usage: { branches: number; counters: number; users: number } }) {
  const t = useT();
  const title = ent.plan ? t("What your {plan} plan includes", { plan: PLAN_RULES[ent.plan].name }) : t("What your plan includes");
  const note = ent.open === "trial" ? t("Your free trial includes every feature. When it ends, you keep what your chosen plan includes.") : ent.open === "unlicensed" ? t("This copy runs without a licence, so every feature is open.") : ent.open === "pending" ? t("Your plan hasn’t been confirmed yet, so every feature is open for now.") : null;
  const limit = (what: "branches" | "counters" | "users", label: string) => {
    const max = ent.limits[what];
    return <div key={what} className="flex justify-between gap-3 py-2 border-b border-row last:border-0 text-[13.5px]"><span className="text-muted">{t(label)}</span><span className={"tnum font-medium" + (max !== null && usage[what] > max ? " text-bad" : "")} title={max !== null && usage[what] > max ? t("Above your plan’s limit. Existing ones keep working; you can’t add more.") : undefined}>{usage[what]} {max === null ? "" : `/ ${max}`}{max === null ? ` ${t("(no limit)")}` : ""}</span></div>;
  };
  return (
    <Card className="mt-3.5 mb-3.5">
      <CardHead title={title} sub={note ?? undefined} />
      <div className="px-4 pb-4 grid gap-x-8 gap-y-3 min-[800px]:grid-cols-2">
        <ul className="m-0 p-0 list-none flex flex-col gap-2">
          {ALL_FEATURES.map((f) => {
            const on = ent.features.includes(f);
            return (
              <li key={f} className="flex items-start gap-2.5 text-[13.5px]">
                {on ? <Check size={15} aria-hidden className="text-ok mt-0.5 flex-none" /> : <Lock size={14} aria-hidden className="text-faint mt-[3px] flex-none" />}
                <span className={on ? "" : "text-muted"}>{t(FEATURES[f])}{on ? "" : <span className="text-faint"> · {t("{plan} plan", { plan: PLAN_RULES[planFor(f)].name })}</span>}</span>
              </li>
            );
          })}
        </ul>
        <div>
          {limit("branches", "Branches")}{limit("counters", "Counters")}{limit("users", "Users")}
        </div>
      </div>
    </Card>
  );
}
