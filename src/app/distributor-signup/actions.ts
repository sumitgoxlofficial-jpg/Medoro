"use server";
import { ZodError } from "zod";
import { createPharmacy } from "@/domain/identity/service";
import { UserError, type ActionResult } from "@/server/action";
import { setupUnlocked, signupOpen } from "@/server/setup-gate";
import { rateLimit } from "@/server/rate-limit";
import { clientInfo } from "@/server/auth";
import { log } from "@/server/log";
import { signupDeployment } from "@/domain/identity/deployment";
import { distHostingAllowed } from "@/domain/distribution/hosting";

/** Creates a MEDORO Distribution tenant (owner, godowns, distribution roles) on a server that allows sign-up. */
export async function createDistributorAction(fd: FormData): Promise<ActionResult<{ code: string }>> {
  if (!signupOpen() && !(await setupUnlocked())) return { ok: false, error: "Sign-up is closed on this server." };
  if (!distHostingAllowed()) return { ok: false, error: "MEDORO Distribution isn’t offered on this hosted server. Run it on your own server or database." };
  const { ip } = await clientInfo();
  if (!(await rateLimit("dist-signup:" + (ip ?? "unknown"), 5, 3600_000))) return { ok: false, error: "Too many sign-ups from this network. Try again in an hour." };
  const g = (k: string) => String(fd.get(k) ?? "").trim();
  const godowns = g("godowns").split(",").map((s) => s.trim()).filter(Boolean).slice(0, 10);
  try {
    const r = await createPharmacy({
      pharmacy: { name: g("name"), code: g("code").toUpperCase(), gstin: g("gstin").toUpperCase(), dl: g("dl"), pharmacist: "", address: g("address"), lang: "en" },
      owner: { name: g("ownerName"), email: g("email").toLowerCase(), phone: g("phone"), password: g("password") },
      deployment: signupDeployment(process.env.DEPLOYMENT_MODE, process.env.DATABASE_URL), branches: (godowns.length ? godowns : ["Main godown"]).map((name) => ({ name, counters: 1 })), invites: [],
      backupKey: g("backupKey"), kitAck: fd.get("kitAck") === "on",
    } as never, { signup: true, product: "distribution" });
    return { ok: true, data: { code: r.tenantCode }, message: "Distributor created. Sign in to finish two-step verification." };
  } catch (e) {
    if (e instanceof ZodError) return { ok: false, error: e.issues[0]?.message ?? "Check the form." };
    if (e instanceof UserError) return { ok: false, error: e.message };
    log.error("Distributor sign-up failed.", { err: e });
    return { ok: false, error: "Something went wrong. Nothing was saved." };
  }
}
