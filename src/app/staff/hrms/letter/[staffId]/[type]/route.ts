import { UserError } from "@/server/action";
import { getReadyMe } from "@/staff/hrms/auth";
import { gateOf } from "@/staff/hrms/gate";
import { letterFor, pdfOf } from "@/staff/hrms/letters-server";

export const dynamic = "force-dynamic";

/** A joining or exit letter as a PDF. Employees get their own joining letters; HR gets anyone's. Never cached. */
export async function GET(req: Request, { params }: { params: Promise<{ staffId: string; type: string }> }) {
  const me = await getReadyMe(["docs"]); // the joining-documents step reads the person's own letters
  if (!me) return new Response("Sign in first.", { status: 401 });
  const { staffId, type } = await params;
  if (gateOf(me) && staffId !== "me" && staffId !== me.id) return new Response("Finish setting up your account first.", { status: 403 });
  try {
    const id = staffId === "me" ? me.id : staffId, l = await letterFor(me, id, type, new URL(req.url).searchParams.get("day") ?? undefined);
    return new Response(new Uint8Array(await pdfOf(id, l)), { headers: { "content-type": "application/pdf", "content-disposition": `${new URL(req.url).searchParams.get("view") ? "inline" : "attachment"}; filename="${l.title.replace(/\W+/g, "-")}.pdf"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
  } catch (e) {
    return new Response(e instanceof UserError ? e.message : "Couldn’t make that letter.", { status: e instanceof UserError ? 403 : 500 });
  }
}
