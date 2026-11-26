import { getMe } from "@/staff/hrms/auth";
import { certificateFor } from "@/staff/hrms/training/service";
import { certificatePdf } from "@/staff/hrms/training/pdf";

export const dynamic = "force-dynamic";

/** A Sales Academy certificate as a PDF: for its holder, their trainer and HR. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getMe();
  if (!me) return new Response("Sign in first.", { status: 401 });
  const c = await certificateFor(me, (await params).id);
  if (!c) return new Response("Not found.", { status: 404 });
  const origin = (process.env.APP_URL || new URL(req.url).origin).replace(/\/+$/, "");
  const pdf = await certificatePdf(c, `${origin}/certificate/verify/${c.verifyCode}`);
  return new Response(new Uint8Array(pdf), { headers: { "content-type": "application/pdf", "content-disposition": `inline; filename="Medoro-Sales-Certificate-${c.certNo}.pdf"`, "x-content-type-options": "nosniff", "cache-control": "private, no-store" } });
}
