import { getMe } from "@/staff/hrms/auth";
import { resourceFor } from "@/staff/hrms/training/service";

export const dynamic = "force-dynamic";

/** A PDF or PowerPoint HR attached to a lesson: for assigned learners (published lessons), trainers and HR. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string; idx: string }> }) {
  const me = await getMe();
  if (!me) return new Response("Sign in first.", { status: 401 });
  const { id, idx } = await params;
  const f = /^\d{1,2}$/.test(idx) ? await resourceFor(me, id, Number(idx)) : null;
  if (!f) return new Response("Not found.", { status: 404 });
  const disp = f.type === "application/pdf" ? "inline" : "attachment";
  return new Response(new Uint8Array(f.bytes), { headers: { "content-type": f.type, "content-disposition": `${disp}; filename="${f.name.replace(/"/g, "")}"`, "x-content-type-options": "nosniff", "cache-control": "private, no-store" } });
}
