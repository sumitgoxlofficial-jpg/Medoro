import { getMe } from "@/staff/hrms/auth";
import { docFile } from "@/staff/hrms/docs";

export const dynamic = "force-dynamic";

/** An employee document (identity, address, certificate), for its owner and HR. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getMe();
  if (!me) return new Response("Sign in first.", { status: 401 });
  const d = await docFile(me, (await params).id);
  if (!d) return new Response("Not found.", { status: 404 });
  return new Response(new Uint8Array(d.bytes), { headers: { "content-type": d.type, "content-disposition": `inline; filename="${d.name.replace(/"/g, "")}"`, "x-content-type-options": "nosniff", "cache-control": "private, no-store" } });
}
