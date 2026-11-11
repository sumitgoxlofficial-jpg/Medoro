import { exchangeCode, googleLogin, safeEqual, takeFlow, verifyIdToken, type GoogleClaims } from "@/server/google-oidc";
import { googleSignIn, linkGoogleToSession } from "@/domain/identity/google";
import { partnerFromGoogle } from "@/staff/people";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const g = googleLogin();
  const url = new URL(req.url);
  const to = (path: string) => Response.redirect(new URL(path, g ? new URL(g.redirect).origin : url.origin), 302);
  if (!g) return to("/signin?google=off");
  const flow = await takeFlow();
  if (!flow || !safeEqual(flow.state, url.searchParams.get("state") ?? "")) return to("/signin?google=state");
  const back = (why: string) => to(flow.intent === "link" ? `/app?google=${why}` : flow.intent === "partner" ? `/staff/login?google=${why}` : `/signin?google=${why}`);
  const code = url.searchParams.get("code");
  if (!code) return back("cancelled");
  let claims: GoogleClaims;
  try {
    claims = await verifyIdToken(await exchangeCode(code, flow.verifier), { clientId: g.id, nonce: flow.nonce });
  } catch (e) {
    console.error(`[google] sign-in failed: ${e instanceof Error ? e.message : "unknown error"}`);
    return back("error");
  }
  if (flow.intent === "link") return back(await linkGoogleToSession(claims));
  if (flow.intent === "partner") return to(await partnerFromGoogle(claims));
  return to(await googleSignIn(claims));
}
