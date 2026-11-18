import type { Metadata } from "next";
import { requireDistCtx } from "@/domain/distribution/context";
import { db } from "@/server/db";
import { accessFor } from "@/domain/system/access";
import { subscriptionBanner } from "@/domain/system/subscription";
import { DistShell } from "./_ui/shell";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: { default: "MEDORO Distribution", template: "%s · MEDORO Distribution" }, robots: { index: false } };

export default async function DistLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requireDistCtx();
  const ids = ctx.branches.map((b) => b.id);
  const [orders, picks, dispatch, expiry, portal, access] = await Promise.all([
    db.distOrder.count({ where: { tenantId: ctx.tenantId, branchId: { in: ids }, status: "pending" } }),
    db.distPickList.count({ where: { tenantId: ctx.tenantId, branchId: ctx.branchId, status: "open" } }),
    db.distDelivery.count({ where: { tenantId: ctx.tenantId, status: "pending", dispatchId: null } }),
    db.batch.count({ where: { tenantId: ctx.tenantId, branchId: { in: ids }, OR: [{ qtyAvailable: { gt: 0 } }, { qtyQuarantined: { gt: 0 } }], expiryDate: { lte: new Date(Date.now() + 30 * 86400000) } } }),
    db.distConnection.count({ where: { tenantId: ctx.tenantId, status: "requested" } }),
    accessFor(ctx.tenantId),
  ]);
  const b = subscriptionBanner(access);
  const banner = ctx.readOnly ? { text: "Medoro support has read-only access.", tone: "amber" as const } : b ? { text: b.text, tone: (b.tone === "red" ? "red" : "amber") as "red" | "amber" } : null;
  return (
    <DistShell tenant={ctx.tenantName} user={ctx.userName} role={ctx.role} perms={ctx.perms} branches={ctx.branches} branchId={ctx.branchId} lang={ctx.lang}
      badges={{ orders, picks, dispatch, expiry, portal }} banner={banner}>
      {children}
    </DistShell>
  );
}
