import { redirect } from "next/navigation";
import { requireDistCtx } from "@/domain/distribution/context";
import { db } from "@/server/db";
import { dataInDrive } from "@/domain/system/drive-state";
import { deviceDriveEnabled } from "@/domain/system/gdrive";
import { DevicePos } from "@/app/app/device-pos/device-pos";
import { DeviceHead } from "@/app/app/device-pos/device-head";
import { DIST_TAB_KEYS, distTabsFor, type Tab } from "@/components/device/tabs";
import { getT } from "@/server/lang";

export const metadata = { title: "Distribution on this device" };

/**
 * MEDORO Distribution for a distributor whose records live in its own Google Drive (docs/DIST_DRIVE_PLAN.md): the
 * wholesale screens run on this device's own database, as Billing (device) does for a pharmacy.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ drive?: string; tab?: string }> }) {
  const ctx = await requireDistCtx();
  const t = await db.tenant.findUniqueOrThrow({ where: { id: ctx.tenantId }, select: { settings: true } });
  const settings = (t.settings ?? {}) as { driveMode?: boolean; driveOnly?: boolean };
  if (!settings.driveMode && !dataInDrive(settings)) redirect("/dist");
  const sp = await searchParams, tr = await getT();
  return (
    <>
      <DeviceHead title="Distribution on this device" sub={tr("Your distribution records live on this device and in your Google Drive, encrypted.")} />
      <DevicePos userId={ctx.userId} userName={ctx.userName} owner={ctx.realRole === "Owner" && ctx.role === "Owner"} canCredit discCap={100}
        drive={await deviceDriveEnabled(ctx.tenantId)} fresh={settings.driveOnly === true} mustMove={!!ctx.mustMove} driveResult={sp.drive ?? null}
        tab={DIST_TAB_KEYS.has(sp.tab ?? "") ? (sp.tab as Tab) : "wholesale"} tabs={distTabsFor(ctx.perms)} />
    </>
  );
}
