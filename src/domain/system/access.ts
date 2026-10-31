import "server-only";
import { db } from "@/server/db";
import { GRACE_DAYS, subscriptionAccess } from "./subscription";
import { razorpayEnabled } from "./razorpay";

export const licenceServer = () => (process.env.LICENSE_SERVER_URL ?? "").trim().replace(/\/+$/, "") || null;

/**
 * Where the pharmacy is in its subscription, from the last signed licence (or the local trial before the first one).
 * A hosted server that takes payments itself (Razorpay) enforces its own trial and paid-until dates.
 */
export async function accessFor(tenantId: string, now = new Date()) {
  const m = await db.subscriptionMeta.findUnique({ where: { tenantId }, select: { status: true, renewsAt: true, graceDays: true, signedDoc: true } });
  return subscriptionAccess({ status: m?.status ?? "active", endsAt: m?.renewsAt ?? null, graceDays: m?.graceDays ?? GRACE_DAYS, signed: !!m?.signedDoc, serverConfigured: !!licenceServer() || razorpayEnabled() }, now);
}
