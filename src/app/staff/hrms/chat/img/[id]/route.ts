import { getMe } from "@/staff/hrms/auth";
import { chatImage } from "@/staff/hrms/chat";

export const dynamic = "force-dynamic";

/** A picture sent in a chat, for the people in that conversation (and the super admin through review). Never cached. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getMe();
  if (!me) return new Response("Sign in first.", { status: 401 });
  const img = await chatImage(me, (await params).id);
  if (!img) return new Response("Not found.", { status: 404 });
  return new Response(new Uint8Array(img.bytes), { headers: { "content-type": img.type, "cache-control": "private, no-store", "x-content-type-options": "nosniff", "content-disposition": "inline" } });
}
