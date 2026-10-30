import { redirect } from "next/navigation";
import { isSetupDone } from "@/domain/identity/service";
import { readSession } from "@/server/auth";
import { setupGate, setupUnlocked } from "@/server/setup-gate";
import { setupDrive } from "@/server/setup-drive";
import { driveAppConfigured } from "@/domain/system/gdrive";
import { Start } from "./start";
import { Unlock } from "./unlock";

export const metadata = { title: "Set up your pharmacy" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ restore?: string }> }) {
  if (await isSetupDone()) {
    // Right after setup the owner is signed in but hasn't enrolled MFA yet; keep the
    // wizard mounted so its final step (invite codes) stays on screen.
    const s = await readSession(true);
    if (!s || s.mfaPassed || s.user.mfaEnabled) redirect("/signin");
  }
  else if (!(await setupUnlocked())) return <Unlock disabled={setupGate() === "disabled"} />;
  const deployment = (process.env.DEPLOYMENT_MODE as "cloud" | "onprem" | "lan" | "single") ?? "lan";
  // Same component tree before and after setup: the refresh after setupAction must not remount the
  // wizard, or its final step (invite codes, shown once) is lost and it starts again at step 1.
  const restore = !(await isSetupDone()) && (await searchParams).restore === "1";
  return <Start deployment={deployment} driveApp={driveAppConfigured()} driveAccount={(await setupDrive())?.account ?? null} restore={restore} />;
}
