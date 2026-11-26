import { getMe } from "@/staff/hrms/auth";
import { videosFor } from "@/staff/hrms/video-catalog";
import { signVideoPass, VIDEO_PASS_COOKIE, VIDEO_PASS_HOURS, VIDEO_PASS_PATH } from "@/lib/hrms-video-pass";

export const dynamic = "force-dynamic";

/**
 * Gives a signed-in staff member's browser a short-lived pass for the training videos their role may watch. The
 * proxy refuses every file under /hrms-videos without it. Called by the Training Videos screen before it shows a video.
 */
export async function POST() {
  const me = await getMe();
  if (!me) return Response.json({ ok: false }, { status: 401 });
  const secret = process.env.SESSION_SECRET ?? "";
  if (!secret) return Response.json({ ok: false }, { status: 503 });
  const slugs = videosFor(me.role, me.perms).map((v) => v.slug);
  const token = await signVideoPass(secret, slugs, Date.now() + VIDEO_PASS_HOURS * 3_600_000);
  const res = Response.json({ ok: true, slugs }, { headers: { "cache-control": "private, no-store" } });
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.headers.append("set-cookie", `${VIDEO_PASS_COOKIE}=${token}; Path=${VIDEO_PASS_PATH}; Max-Age=${VIDEO_PASS_HOURS * 3600}; HttpOnly; SameSite=Lax${secure}`);
  return res;
}
