import { getReadyMe } from "@/staff/hrms/auth";
import { resumeFile } from "@/staff/hrms/careers";

export const dynamic = "force-dynamic";

/** A candidate's résumé from the careers page, for people with the Recruitment module. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getReadyMe();
  if (!me) return new Response("Sign in first.", { status: 401 });
  let f: Awaited<ReturnType<typeof resumeFile>>;
  try { f = await resumeFile(me, (await params).id); } catch { return new Response("Not allowed.", { status: 403 }); }
  if (!f) return new Response("Not found.", { status: 404 });
  return new Response(new Uint8Array(f.bytes), { headers: { "content-type": f.type, "content-disposition": `inline; filename="${f.name.replace(/"/g, "")}"`, "x-content-type-options": "nosniff", "cache-control": "private, no-store" } });
}
