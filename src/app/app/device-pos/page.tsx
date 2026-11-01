import { redirect } from "next/navigation";
import { requireCtx, can } from "@/server/context";
import { driveModeOn } from "@/domain/system/drive-mode";
import { db } from "@/server/db";
import { discountCap } from "@/domain/identity/permissions";
import { maxDiscount } from "@/domain/sales/approval";
import { deviceDriveEnabled } from "@/domain/system/gdrive";
import { PageHead } from "@/components/page-head";
import { DevicePos } from "./device-pos";

export const metadata = { title: "Billing on this device" };

/** Drive mode pilot: billing that runs on this device's own database, not Medoro's server. */
export default async function Page({ searchParams }: { searchParams: Promise<{ drive?: string }> }) {
  const ctx = await requireCtx();
  if (!can(ctx, "sale")) redirect("/app");
  // Where Drive is required, a pharmacy still on Medoro's copy bills here and moves its data from here.
  if (ctx.mustMove && !(await driveModeOn(ctx.tenantId))) {
    const t = await db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { settings: true } });
    await db.tenant.update({ where: { id: ctx.tenantId }, data: { settings: { ...((t.settings ?? {}) as object), driveMode: true } } });
  }
  if (!(await driveModeOn(ctx.tenantId))) redirect("/app/pos");
  const settings = ((await db.tenant.findUnique({ where: { id: ctx.tenantId }, select: { settings: true } }))?.settings ?? {}) as { driveOnly?: boolean; driveMove?: unknown };
  const fresh = settings.driveOnly === true, inDrive = fresh || !!settings.driveMove;
  const cap = Math.min(discountCap(ctx.perms), await maxDiscount(ctx.tenantId));
  return (
    <>
      <PageHead title="Billing on this device" sub={`${ctx.mustMove ? "Medoro now keeps every pharmacy’s data in its own Google Drive. Move yours here to keep billing." : inDrive ? "Your pharmacy’s records live on this device and in your Google Drive, encrypted." : "Drive mode (pilot): bills are saved in this device’s own database and queued for your Google Drive."} F2 search · F9 complete`} />
      <DevicePos userId={ctx.userId} userName={ctx.userName} owner={ctx.realRole === "Owner" && ctx.role === "Owner"} canCredit={can(ctx, "credit")} discCap={cap} drive={await deviceDriveEnabled(ctx.tenantId)} fresh={fresh} mustMove={!!ctx.mustMove} driveResult={(await searchParams).drive ?? null} />
    </>
  );
}
