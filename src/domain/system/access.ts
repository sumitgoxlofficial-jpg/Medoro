import "server-only";
import { db } from "@/server/db";
import { GRACE_DAYS, subscriptionAccess } from "./subscription";
import { razorpayEnabled } from "./razorpay";
import { entitlements } from "@/lib/plans";

export const licenceServer = () => (process.env.LICENSE_SERVER_URL ?? "").trim().replace(/\/+$/, "") || null;

/**
 * Where the pharmacy is in its subscription, from the last signed licence (or the local trial before the first one),
 * and what its plan includes. A hosted server that takes payments itself (Razorpay) enforces its own trial and paid-until dates.
 */
export async function licenceState(tenantId: string, now = new Date()) {
  const m = await db.subscriptionMeta.findUnique({ where: { tenantId }, select: { plan: true, addons: true, status: true, renewsAt: true, graceDays: true, signedDoc: true } });
  const access = subscriptionAccess({ status: m?.status ?? "active", endsAt: m?.renewsAt ?? null, graceDays: m?.graceDays ?? GRACE_DAYS, signed: !!m?.signedDoc, serverConfigured: !!licenceServer() || razorpayEnabled() }, now);
  return { access, ent: entitlements({ plan: m?.plan ?? null, status: m?.status ?? null, unlicensed: access.phase === "unlicensed", addons: m?.addons }) };
}
export async function accessFor(tenantId: string, now = new Date()) {
  return (await licenceState(tenantId, now)).access;
}
