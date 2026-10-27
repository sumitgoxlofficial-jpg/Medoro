import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { getCtx } from "@/server/context";
import { consentUrl, driveAppConfigured } from "@/domain/system/gdrive";

export async function GET() {
  const ctx = await getCtx();
  if (ctx?.readOnly) return new Response("Medoro support access is read-only.", { status: 403 });
  if (!ctx || !ctx.perms.includes("integrations")) return new Response("Forbidden", { status: 403 });
  if (!driveAppConfigured()) return new Response("Google OAuth isn't configured on this server.", { status: 400 });
  const state = randomBytes(16).toString("base64url");
  (await cookies()).set("medoro_gstate", state, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 600 });
  return Response.redirect(consentUrl(state), 302);
}
