import { getCtx } from "@/server/context";
import { readSession } from "@/server/auth";
import { beginGoogle, googleLogin } from "@/server/google-oidc";
import { careersPath } from "@/server/applicant";

export const dynamic = "force-dynamic";

/** /api/auth/google/start?intent=signin|link|partner|careers → Google's consent screen. */
export async function GET(req: Request) {
  const g = googleLogin();
  const to = (path: string) => Response.redirect(new URL(path, g ? new URL(g.redirect).origin : new URL(req.url).origin), 302);
  const asked = new URL(req.url).searchParams.get("intent");
  if (asked === "careers") {
    const next = careersPath(new URL(req.url).searchParams.get("next"));
    if (!g) return to(`${next}${next.includes("?") ? "&" : "?"}signin=off`);
    return Response.redirect(await beginGoogle("careers", next), 302);
  }
  if (asked === "partner") {
    if (!g) return to("/staff/login?google=off");
    return Response.redirect(await beginGoogle("partner"), 302);
  }
  if (!g) return to("/signin?google=off");
  const intent = asked === "link" ? "link" : "signin";
  if (intent === "link") {
    const ctx = await getCtx();
    if (!ctx || ctx.readOnly) return to("/signin");
  } else if (await readSession()) return to("/app");
  return Response.redirect(await beginGoogle(intent), 302);
}
