import { getReadyMe } from "@/staff/hrms/auth";
import { lessonForNotes } from "@/staff/hrms/training/service";
import { notesPdf } from "@/staff/hrms/training/pdf";

export const dynamic = "force-dynamic";

/** A lesson's slides, narration and notes as a PDF handout: for assigned learners, trainers and HR. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getReadyMe();
  if (!me) return new Response("Sign in first.", { status: 401 });
  const l = await lessonForNotes(me, (await params).id);
  if (!l) return new Response("Not found.", { status: 404 });
  const pdf = await notesPdf(l);
  const name = l.title.replace(/[^\w ]+/g, "").trim().replace(/\s+/g, "-").slice(0, 60) || "lesson";
  return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="${name}-slides.pdf"`, "x-content-type-options": "nosniff", "cache-control": "private, no-store" } });
}
