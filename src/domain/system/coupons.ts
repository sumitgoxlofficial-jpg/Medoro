import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { UserError } from "@/server/action";

/** Subscription coupons: a percentage off the GST-inclusive plan price, made in the staff console. */
export const COUPON_PLANS = ["starter", "pro", "multi"] as const;
export const normCode = (s: string) => String(s ?? "").toUpperCase().replace(/\s+/g, "");

export const couponSchema = z.object({
  code: z.string().transform(normCode).pipe(z.string().regex(/^[A-Z0-9-]{3,20}$/, "Code: 3 to 20 letters, numbers or dashes, like LAUNCH20.")),
  percentOff: z.coerce.number().int("Whole percent only.").min(0).max(100, "At most 100% off.").default(0),
  /** A fixed price instead of a percentage, in rupees (GST included), e.g. 1 for a ₹1 test payment. */
  payRupees: z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.number().min(1, "A fixed price must be at least ₹1 (Razorpay’s minimum).").max(100000).nullable()).default(null),
  plans: z.array(z.enum(COUPON_PLANS)).default([]),
  maxUses: z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.number().int().min(1, "Uses must be 1 or more.").nullable()).default(null),
  expiresOn: z.preprocess((v) => (v === "" ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()).default(null),
  note: z.string().trim().max(200).optional().default(""),
}).refine((c) => c.payRupees !== null || c.percentOff >= 1, { message: "Give a percent off (1 to 100) or a fixed price.", path: ["percentOff"] });

/** Last moment of an IST calendar day. */
export const endOfIstDay = (iso: string) => new Date(new Date(iso + "T23:59:59.999+05:30").getTime());

/** The coupon if `code` can be used for `plan` right now; otherwise a UserError saying why. */
export async function usableCoupon(code: string, plan: string, now = new Date()) {
  const c = await db.coupon.findUnique({ where: { code: normCode(code) } });
  if (!c || !c.active) throw new UserError("That coupon code isn’t valid.");
  if (c.expiresAt && c.expiresAt < now) throw new UserError("That coupon has expired.");
  if (c.maxUses !== null && c.uses >= c.maxUses) throw new UserError("That coupon has been used up.");
  if (c.plans.length && !c.plans.includes(plan)) throw new UserError("That coupon doesn’t apply to this plan.");
  return c;
}

/** Discount in paise for a GST-inclusive total: a fixed price (never above the list price) or a percentage. */
export const discountOf = (total: number, c: { percentOff: number; payPaise?: number | null }) =>
  c.payPaise != null ? Math.max(0, total - c.payPaise) : Math.round((total * c.percentOff) / 100);

/** How a coupon reads to the pharmacy: "20% off" or "pay ₹1". */
export const couponLabel = (c: { percentOff: number; payPaise?: number | null }) =>
  c.payPaise != null ? `pay ₹${(c.payPaise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}` : `${c.percentOff}% off`;
