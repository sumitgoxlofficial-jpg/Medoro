import { redirect } from "next/navigation";
import { isSetupDone } from "@/domain/identity/service";
import { readSession } from "@/server/auth";
import { setupGate, setupUnlocked } from "@/server/setup-gate";
import { Unlock } from "./unlock";
import { Wizard } from "./wizard";
import { DEPLOYMENTS, databaseKind, type Deployment } from "@/domain/identity/deployment";

export const metadata = { title: "Set up your pharmacy" };
export const dynamic = "force-dynamic";

export default async function Page() {
  if (await isSetupDone()) {
    // Right after setup the owner is signed in but hasn't enrolled MFA yet; keep the
    // wizard mounted so its final step (invite codes) stays on screen.
    const s = await readSession(true);
    if (!s || s.mfaPassed || s.user.mfaEnabled) redirect("/signin");
  }
  else if (!(await setupUnlocked())) return <Unlock disabled={setupGate() === "disabled"} />;
  const mode = process.env.DEPLOYMENT_MODE as Deployment | undefined;
  return <Wizard deployment={mode && DEPLOYMENTS.includes(mode) ? mode : databaseKind(process.env.DATABASE_URL) === "managed" ? "hosted" : "lan"} />;
}
