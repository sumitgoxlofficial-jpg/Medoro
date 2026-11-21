import { PRODUCTS } from "@/staff/constants";
import { DIST_PLANS, type DistPlanId } from "@/domain/distribution/plans";

/** A plan (or add-on) that can be paid for on the Subscription page. `m` is the monthly list price in rupees, GST included. */
export type PayItem = { id: string; name: string; m: number; addon?: boolean };

/** MEDORO Pharmacy: the three plans and the AI add-on. */
export const PHARMACY_PAY: PayItem[] = PRODUCTS.filter((p) => !("once" in p)).map((p) => ({ id: p.id, name: p.name, m: p.m, ...("addon" in p ? { addon: true } : {}) }));
/** MEDORO Distribution: its three plans (AI business intelligence is part of the plans, so there is no add-on). */
export const DIST_PAY_IDS = Object.keys(DIST_PLANS) as DistPlanId[];
export const DIST_PAY: PayItem[] = DIST_PAY_IDS.map((id) => ({ id, name: DIST_PLANS[id].name, m: DIST_PLANS[id].priceMonthly / 100 }));

const ALL = [...PHARMACY_PAY, ...DIST_PAY];
export const payItem = (id: string) => ALL.find((p) => p.id === id);
export const isDistPlan = (id: string) => (DIST_PAY_IDS as string[]).includes(id);
