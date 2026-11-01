import { signupOpen } from "@/server/setup-gate";

export const dynamic = "force-dynamic";

/**
 * Every "Start free trial" button lands here: straight to account creation when this server takes sign-ups
 * (medoro.in), otherwise to the trial request form on /start. A partner's link (?ref=CODE) remembers the
 * referral code for 30 days, so it's filled in on sign-up even after "Continue with Google".
 */
export function GET(req: Request) {
  const url = new URL(req.url);
  const to = new URL(signupOpen() ? "/signup" : "/start", process.env.APP_URL || req.url);
  const headers = new Headers({ Location: to.toString() });
  const ref = (url.searchParams.get("ref") ?? "").trim().toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20);
  if (ref) headers.append("Set-Cookie", `medoro_ref=${ref}; Path=/; Max-Age=${30 * 86400}; SameSite=Lax; HttpOnly${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
  return new Response(null, { status: 307, headers });
}
