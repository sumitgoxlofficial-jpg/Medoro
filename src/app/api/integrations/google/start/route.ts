import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getCtx } from "@/server/context";
import { restoreAllowed } from "@/app/(auth)/setup/setup-step";
import { consentUrl, driveAppConfigured, pkce } from "@/domain/system/gdrive";

/**
 * Starts Google consent for Drive. `?setup=1`: during first-run setup, before a pharmacy exists (opened in a popup).
 * `?back=device`: come back to Billing (device) afterwards, for a pharmacy whose data lives in Drive.
 */
export async function GET(req: Request) {
  const sp = new URL(req.url).searchParams;
  const setup = sp.get("setup") === "1";
  if (setup) {
    if (!(await restoreAllowed())) return new Response("Setup is closed.", { status: 403 });
  } else {
    const ctx = await getCtx();
    if (ctx?.readOnly) return new Response("Medoro support access is read-only.", { status: 403 });
    if (!ctx || !ctx.perms.includes("integrations")) return new Response("Forbidden", { status: 403 });
  }
  if (!driveAppConfigured()) return new Response("Google OAuth isn't configured on this server.", { status: 400 });
  const state = randomBytes(16).toString("base64url");
  const { verifier, challenge } = pkce();
  (await cookies()).set("medoro_gstate", `${setup ? "setup" : sp.get("back") === "device" ? "device" : "app"}.${state}.${verifier}`, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/api/integrations/google", maxAge: 600 });
  return Response.redirect(consentUrl(state, challenge), 302);
}
