import { redirect } from "next/navigation";
import { requireCtx, can } from "@/server/context";
import { driveModeOn } from "@/domain/system/drive-mode";
import { discountCap } from "@/domain/identity/permissions";
import { maxDiscount } from "@/domain/sales/approval";
import { deviceDriveEnabled } from "@/domain/system/gdrive";
import { PageHead } from "@/components/page-head";
import { DevicePos } from "./device-pos";

export const metadata = { title: "Billing on this device" };

/** Drive mode pilot: billing that runs on this device's own database, not Medoro's server. */
export default async function Page() {
  const ctx = await requireCtx();
  if (!can(ctx, "sale")) redirect("/app");
  if (!(await driveModeOn(ctx.tenantId))) redirect("/app/pos");
  const cap = Math.min(discountCap(ctx.perms), await maxDiscount(ctx.tenantId));
  return (
    <>
      <PageHead title="Billing on this device" sub="Drive mode (pilot): bills are saved in this device’s own database and queued for your Google Drive. F2 search · F9 complete" />
      <DevicePos userId={ctx.userId} owner={ctx.realRole === "Owner" && ctx.role === "Owner"} canCredit={can(ctx, "credit")} discCap={cap} drive={await deviceDriveEnabled(ctx.tenantId)} />
    </>
  );
}
