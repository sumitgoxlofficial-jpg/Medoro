// MEDORO Distribution plans. Enforced on the server; the licence server issues the plan name. The free trial,
// a copy running without a licence server and an install not yet confirmed by it get everything (as for Pharmacy).

export const DIST_FEATURES = {
  portal: "Chemist ordering portal",
  field: "Salesman field app",
  warehouse: "Mobile warehouse picking & dispatch",
  insights: "AI business intelligence",
  multiGodown: "Multiple godowns & stock transfers",
  einvoice: "E-invoice & e-way bill (needs your GSP / NIC credentials)",
} as const;
export type DistFeature = keyof typeof DIST_FEATURES;

export type DistPlanId = "dist_std" | "dist_pro" | "dist_ent";
export type DistLimits = { godowns: number; users: number; chemists: number };

export const DIST_PLANS: Record<DistPlanId, { name: string; features: readonly DistFeature[]; limits: DistLimits; priceMonthly: number }> = {
  dist_std: { name: "Distribution Standard", features: ["warehouse"], limits: { godowns: 1, users: 8, chemists: 300 }, priceMonthly: 2499_00 },
  dist_pro: { name: "Distribution Professional", features: ["portal", "field", "warehouse", "insights", "einvoice"], limits: { godowns: 3, users: 25, chemists: 2000 }, priceMonthly: 4999_00 },
  dist_ent: { name: "Distribution Enterprise", features: ["portal", "field", "warehouse", "insights", "multiGodown", "einvoice"], limits: { godowns: 20, users: 150, chemists: 20000 }, priceMonthly: 9999_00 },
};

export function distPlanOf(raw: string | null | undefined): DistPlanId | null {
  const s = (raw ?? "").trim().toLowerCase();
  if (s === "dist_std" || s === "distribution standard") return "dist_std";
  if (s === "dist_pro" || s === "distribution professional") return "dist_pro";
  if (s === "dist_ent" || s === "distribution enterprise") return "dist_ent";
  return null;
}

export type DistEntitlements = { plan: DistPlanId | null; open: "trial" | "unlicensed" | "pending" | null; features: readonly DistFeature[]; limits: DistLimits };

const ALL = Object.keys(DIST_FEATURES) as DistFeature[];
const OPEN_LIMITS: DistLimits = { godowns: Infinity, users: Infinity, chemists: Infinity };

export function distEntitlements(i: { plan: string | null; status: string | null; unlicensed: boolean }): DistEntitlements {
  if (i.unlicensed) return { plan: null, open: "unlicensed", features: ALL, limits: OPEN_LIMITS };
  if (i.status === "trial") return { plan: null, open: "trial", features: ALL, limits: OPEN_LIMITS };
  const id = distPlanOf(i.plan);
  if (!id) return { plan: null, open: "pending", features: ALL, limits: OPEN_LIMITS };
  return { plan: id, open: null, features: DIST_PLANS[id].features, limits: DIST_PLANS[id].limits };
}

export const distHas = (e: DistEntitlements, f: DistFeature) => e.features.includes(f);
export const distUpgrade = (e: DistEntitlements, f: DistFeature) =>
  `${DIST_FEATURES[f]} is not part of your ${e.plan ? DIST_PLANS[e.plan].name : "current"} plan. Upgrade under Subscription.`;
