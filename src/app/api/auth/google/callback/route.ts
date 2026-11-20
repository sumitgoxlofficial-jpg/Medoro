import { exchangeCode, googleLogin, safeEqual, takeFlow, verifyIdToken, type GoogleClaims } from "@/server/google-oidc";
import { googleSignIn, linkGoogleToSession } from "@/domain/identity/google";
import { partnerFromGoogle } from "@/staff/people";
import { careersPath, setApplicant } from "@/server/applicant";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const g = googleLogin();
  const url = new URL(req.url);
  const to = (path: string) => Response.redirect(new URL(path, g ? new URL(g.redirect).origin : url.origin), 302);
  if (!g) return to("/signin?google=off");
  const flow = await takeFlow();
  if (!flow || !safeEqual(flow.state, url.searchParams.get("state") ?? "")) return to("/signin?google=state");
  const careers = careersPath(flow.next);
  const back = (why: string) => to(flow.intent === "link" ? `/app?google=${why}` : flow.intent === "partner" ? `/staff/login?google=${why}` : flow.intent === "careers" ? `${careers}${careers.includes("?") ? "&" : "?"}signin=${why}` : `/signin?google=${why}`);
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
  if (flow.intent === "careers") {
    await setApplicant({ email: claims.email, name: claims.name ?? "", via: "google" });
    return to(careers);
  }
  const dest = await googleSignIn(claims);
  return to(flow.next === "dist" && dest.startsWith("/signup") ? "/distributor-signup" : dest);
}
