import { UserError } from "@/server/action";
import { getMe } from "@/staff/hrms/auth";
import { letterFor, letterPdf } from "@/staff/hrms/letters-server";

export const dynamic = "force-dynamic";

/** A joining or exit letter as a PDF. Employees get their own joining letters; HR gets anyone's. Never cached. */
export async function GET(req: Request, { params }: { params: Promise<{ staffId: string; type: string }> }) {
  const me = await getMe();
  if (!me) return new Response("Sign in first.", { status: 401 });
  const { staffId, type } = await params;
  try {
    const l = await letterFor(me, staffId === "me" ? me.id : staffId, type, new URL(req.url).searchParams.get("day") ?? undefined);
    return new Response(new Uint8Array(await letterPdf(l)), { headers: { "content-type": "application/pdf", "content-disposition": `attachment; filename="${l.title.replace(/\W+/g, "-")}.pdf"`, "cache-control": "private, no-store", "x-content-type-options": "nosniff" } });
  } catch (e) {
    return new Response(e instanceof UserError ? e.message : "Couldn’t make that letter.", { status: e instanceof UserError ? 403 : 500 });
  }
}
