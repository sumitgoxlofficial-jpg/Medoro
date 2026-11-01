import { redirect } from "next/navigation";
import { requireCtx } from "@/server/context";
import { driveConfigured } from "@/domain/system/gdrive";
import { PageHead } from "@/components/page-head";
import { SpeedTest } from "./speed-test";
import { DeviceBilling } from "./device-billing";

export const metadata = { title: "Speed test" };

/** DriveDB Phase 0: measures whether this device can run the pharmacy database itself, with Google Drive as storage. */
export default async function Page() {
  const ctx = await requireCtx();
  if (ctx.realRole !== "Owner") redirect("/app");
  return (
    <>
      <PageHead title="Device speed test" sub="Checks if this phone or computer can run your pharmacy database itself, with your Google Drive as storage. Uses sample data only; your real data isn't touched." />
      <div className="flex flex-col gap-4 max-w-3xl">
        <DeviceBilling />
        <SpeedTest drive={await driveConfigured(ctx.tenantId)} />
      </div>
    </>
  );
}
