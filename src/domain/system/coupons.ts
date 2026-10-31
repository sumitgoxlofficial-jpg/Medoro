import "server-only";
import { z } from "zod";
import { db } from "@/server/db";
import { UserError } from "@/server/action";

/** Subscription coupons: a percentage off the GST-inclusive plan price, made in the staff console. */
export const COUPON_PLANS = ["starter", "pro", "multi"] as const;
export const normCode = (s: string) => String(s ?? "").toUpperCase().replace(/\s+/g, "");

export const couponSchema = z.object({
  code: z.string().transform(normCode).pipe(z.string().regex(/^[A-Z0-9-]{3,20}$/, "Code: 3 to 20 letters, numbers or dashes, like LAUNCH20.")),
  percentOff: z.coerce.number().int("Whole percent only.").min(1, "At least 1% off.").max(100, "At most 100% off."),
  plans: z.array(z.enum(COUPON_PLANS)).default([]),
  maxUses: z.preprocess((v) => (v === "" || v == null ? null : v), z.coerce.number().int().min(1, "Uses must be 1 or more.").nullable()).default(null),
  expiresOn: z.preprocess((v) => (v === "" ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable()).default(null),
  note: z.string().trim().max(200).optional().default(""),
});

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

/** Discount in paise for a GST-inclusive total. */
export const discountOf = (total: number, percentOff: number) => Math.round((total * percentOff) / 100);
