import "server-only";
import type { z } from "zod";
import { Prisma } from "@prisma/client";
import { db } from "@/server/db";
import { UserError } from "@/server/action";
import { allow, staffAudit, type Staff } from "./auth";
import { couponSchema, endOfIstDay } from "@/domain/system/coupons";

/** Coupon codes pharmacies can enter before paying online (super admin only). */
export async function listCoupons() {
  const rows = await db.coupon.findMany({ orderBy: [{ active: "desc" }, { createdAt: "desc" }] });
  return rows.map((c) => ({ ...c, expiresAt: c.expiresAt?.toISOString() ?? null, createdAt: c.createdAt.toISOString() }));
}

export async function createCoupon(s: Staff, raw: z.input<typeof couponSchema>) {
  allow(s, "super_admin");
  const i = couponSchema.parse(raw);
  try {
    await db.coupon.create({ data: { code: i.code, percentOff: i.percentOff, plans: i.plans, maxUses: i.maxUses, expiresAt: i.expiresOn ? endOfIstDay(i.expiresOn) : null, note: i.note || null, createdBy: s.name } });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") throw new UserError(`${i.code} already exists.`);
    throw e;
  }
  await staffAudit(s, "Coupon created", `${i.code} · ${i.percentOff}% off${i.plans.length ? ` · ${i.plans.join(", ")}` : ""}${i.maxUses ? ` · ${i.maxUses} uses` : ""}${i.expiresOn ? ` · until ${i.expiresOn}` : ""}`);
  return i.code;
}

export async function setCouponActive(s: Staff, id: string, active: boolean) {
  allow(s, "super_admin");
  const c = await db.coupon.update({ where: { id }, data: { active } });
  await staffAudit(s, active ? "Coupon switched on" : "Coupon switched off", c.code);
}
