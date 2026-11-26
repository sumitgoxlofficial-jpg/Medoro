import { getMe } from "@/staff/hrms/auth";
import { videoLinks } from "@/staff/hrms/video-links";

export const dynamic = "force-dynamic";

/** Short-lived signed links to the training videos the signed-in staff member's role may watch (Training Videos screen). */
export async function POST() {
  const me = await getMe();
  if (!me) return Response.json({ ok: false }, { status: 401 });
  const links = await videoLinks(me);
  if (!links) return Response.json({ ok: false }, { status: 503 });
  return Response.json({ ok: true, links }, { headers: { "cache-control": "private, no-store" } });
}
