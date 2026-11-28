import { UserError } from "@/server/action";
import { getReadyMe } from "@/staff/hrms/auth";
import { candidateLetter, letterPdf } from "@/staff/hrms/letters-server";
import { signedOfferPdf } from "@/staff/hrms/offer-sign";

export const dynamic = "force-dynamic";

/** A candidate's offer letter as a PDF (Recruitment module): the letter as prepared, or with ?signed=1 the copy the candidate e-signed. Never cached. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getReadyMe();
  if (!me) return new Response("Sign in first.", { status: 401 });
  const q = new URL(req.url).searchParams, id = (await params).id;
  try {
    const signed = q.get("signed") ? await signedOfferPdf(me, id) : null;
    const pdf = signed ? signed.pdf : await letterPdf(await candidateLetter(me, id));
    const name = signed ? "Offer-letter-signed.pdf" : "Offer-letter.pdf";
    return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `${q.get("view") ? "inline" : "attachment"}; filename="${name}"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
  } catch (e) {
    return new Response(e instanceof UserError ? e.message : "Couldn’t make that letter.", { status: e instanceof UserError ? 403 : 500 });
  }
}
