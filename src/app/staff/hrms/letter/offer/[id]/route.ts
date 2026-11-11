import { UserError } from "@/server/action";
import { getMe } from "@/staff/hrms/auth";
import { candidateLetter, letterPdf } from "@/staff/hrms/letters-server";

export const dynamic = "force-dynamic";

/** A candidate's offer letter as a PDF (Recruitment module). Never cached. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getMe();
  if (!me) return new Response("Sign in first.", { status: 401 });
  try {
    const l = await candidateLetter(me, (await params).id);
    return new Response(new Uint8Array(await letterPdf(l)), { headers: { "content-type": "application/pdf", "content-disposition": 'attachment; filename="Offer-letter.pdf"', "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
  } catch (e) {
    return new Response(e instanceof UserError ? e.message : "Couldn’t make that letter.", { status: e instanceof UserError ? 403 : 500 });
  }
}
