import { signupOpen } from "@/server/setup-gate";

export const dynamic = "force-dynamic";

/**
 * Every "Start free trial" button lands here: straight to account creation when this server takes sign-ups
 * (medoro.in), otherwise to the trial request form on /start.
 */
export function GET(req: Request) {
  return Response.redirect(new URL(signupOpen() ? "/signup" : "/start", process.env.APP_URL || req.url), 307);
}
