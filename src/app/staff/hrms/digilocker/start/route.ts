import { getMe } from "@/staff/hrms/auth";
import { beginVerify, digilockerConfigured } from "@/staff/hrms/digilocker";
import { UserError } from "@/server/action";

export const dynamic = "force-dynamic";

/** "Verify with DigiLocker" lands here: needs a signed-in employee with an Aadhaar number saved, then goes to DigiLocker. */
export async function GET(req: Request) {
  const to = (path: string) => Response.redirect(new URL(path, req.url), 302);
  const me = await getMe();
  if (!me) return to("/staff/login");
  if (!digilockerConfigured()) return to("/staff/hrms?digilocker=off");
  try { return Response.redirect(await beginVerify(me), 302); }
  catch (e) { return to("/staff/hrms?digilocker=failed&why=" + encodeURIComponent(e instanceof UserError ? e.message : "Couldn’t start DigiLocker.")); }
}
