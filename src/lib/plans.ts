// What each plan includes. Shared by the server (which enforces it) and the screens (which explain it).
// The rules mirror the pricing table on the website. The free trial, a pharmacy running its own copy with no
// licence, and an install that has not yet heard from the licence server all get everything.

export type PlanId = "starter" | "pro" | "multi";

export const FEATURES = {
  accounts: "Accounts: day book, P&L, ledgers, expenses, GST summaries and returns",
  credit: "Customer credit and statements",
  scanner: "Supplier invoice scanner",
  roles: "Roles, permissions and the audit trail",
  offline: "Billing on the shop network when the internet drops",
  transfers: "Branch stock transfers",
  central: "Central purchasing across branches",
  consolidated: "Consolidated reports across branches",
  anomaly: "Anomaly review for owners",
} as const;
export type Feature = keyof typeof FEATURES;

const PRO: Feature[] = ["accounts", "credit", "scanner", "roles", "offline"];
const MULTI: Feature[] = [...PRO, "transfers", "central", "consolidated", "anomaly"];

export type Limits = { branches: number; counters: number; users: number };
export const PLAN_RULES: Record<PlanId, { name: string; features: readonly Feature[]; limits: Limits }> = {
  starter: { name: "Starter", features: [], limits: { branches: 1, counters: 2, users: 3 } },
  pro: { name: "Professional", features: PRO, limits: { branches: 1, counters: 5, users: 10 } },
  multi: { name: "Multi-branch", features: MULTI, limits: { branches: 5, counters: 15, users: 25 } },
};
export const ALL_FEATURES = Object.keys(FEATURES) as Feature[];
/** The cheapest plan that has a feature: what the upgrade message points to. */
export const planFor = (f: Feature): PlanId => (PLAN_RULES.pro.features.includes(f) ? "pro" : "multi");

/** The plan a stored plan name or id means ("Professional", "pro", "Multi-branch"…), or null when it is not one of ours. */
export function planIdOf(raw: string | null | undefined): PlanId | null {
  const s = (raw ?? "").trim().toLowerCase();
  if (s === "starter") return "starter";
  if (s === "pro" || s === "professional") return "pro";
  if (s === "multi" || s === "multi-branch" || s === "multibranch") return "multi";
  return null;
}

export type Entitlements = {
  /** The plan being applied: null while everything is open (trial, own copy, or not yet licensed). */
  plan: PlanId | null;
  /** Why everything is open, when it is. */
  open: "trial" | "unlicensed" | "pending" | null;
  features: readonly Feature[];
  limits: Limits;
};

/**
 * What a pharmacy may use. `status` and `plan` are as stored from the licence; `unlicensed` is a copy that is not
 * under any licence server (never limited). Extra branches bought as add-ons ("branch") raise the branch limit.
 */
export function entitlements(i: { plan: string | null; status: string | null; unlicensed: boolean; addons?: string[] }): Entitlements {
  const everything = (open: NonNullable<Entitlements["open"]>): Entitlements => ({ plan: null, open, features: ALL_FEATURES, limits: { ...PLAN_RULES.multi.limits, branches: Infinity, counters: Infinity, users: Infinity } });
  if (i.unlicensed) return everything("unlicensed");
  if (i.status === "trial") return everything("trial");
  const id = planIdOf(i.plan);
  if (!id) return everything("pending");
  const r = PLAN_RULES[id];
  const extra = (i.addons ?? []).filter((a) => a === "branch").length;
  return { plan: id, open: null, features: r.features, limits: { ...r.limits, branches: r.limits.branches + (id === "multi" ? extra : 0) } };
}
export const hasFeature = (e: Entitlements, f: Feature) => e.features.includes(f);

/** The message shown when a plan does not include something. */
export const upgradeMessage = (e: Entitlements, f: Feature) => `${FEATURES[f]} is not part of your ${e.plan ? PLAN_RULES[e.plan].name : "current"} plan. Upgrade to ${PLAN_RULES[planFor(f)].name} under Subscription.`;
export const limitMessage = (e: Entitlements, what: keyof Limits, limit: number) => `Your ${e.plan ? PLAN_RULES[e.plan].name : "current"} plan allows ${limit} ${what === "branches" ? (limit === 1 ? "branch" : "branches") : what === "counters" ? (limit === 1 ? "counter" : "counters") : (limit === 1 ? "user" : "users")}. Upgrade under Subscription to add more.`;
