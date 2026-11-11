import { getMe } from "@/staff/hrms/auth";
import { selfieImage } from "@/staff/hrms/monitor";

export const dynamic = "force-dynamic";

/** A check-in selfie, for the employee it belongs to and for HR (Attendance module). Never cached. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getMe();
  if (!me) return new Response("Sign in first.", { status: 401 });
  const img = await selfieImage(me, (await params).id);
  if (!img) return new Response("Not found.", { status: 404 });
  return new Response(new Uint8Array(img), { headers: { "content-type": "image/jpeg", "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-disposition": "inline" } });
}
