import { redirect } from "next/navigation";
import { isSetupDone } from "@/domain/identity/service";
import { readSession } from "@/server/auth";
import { Wizard } from "./wizard";

export const metadata = { title: "Set up your pharmacy" };
export const dynamic = "force-dynamic";

export default async function Page() {
  if (await isSetupDone()) {
    // Right after setup the owner is signed in but hasn't enrolled MFA yet; keep the
    // wizard mounted so its final step (invite codes) stays on screen.
    const s = await readSession(true);
    if (!s || s.mfaPassed || s.user.mfaEnabled) redirect("/signin");
  }
  return <Wizard deployment={(process.env.DEPLOYMENT_MODE as "cloud" | "onprem" | "lan" | "single") ?? "lan"} />;
}
