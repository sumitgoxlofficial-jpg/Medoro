import { getMe } from "@/staff/hrms/auth";
import { beginConnect, gcalConfigured } from "@/staff/hrms/gcal";

export const dynamic = "force-dynamic";

/** The "Connect Google Calendar" button lands here: needs a signed-in employee, then goes to Google's consent screen. */
export async function GET(req: Request) {
  const to = (path: string) => Response.redirect(new URL(path, req.url), 302);
  const me = await getMe();
  if (!me) return to("/staff/employee");
  if (!gcalConfigured()) return to("/staff/hrms/calendar?google=off");
  return Response.redirect(await beginConnect(me), 302);
}
