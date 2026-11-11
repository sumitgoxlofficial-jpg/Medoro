import { getMe } from "@/staff/hrms/auth";
import { claimBill } from "@/staff/hrms/time";

export const dynamic = "force-dynamic";

/** A reimbursement bill, for its owner, HR reviewers and the super admin. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const me = await getMe();
  if (!me) return new Response("Sign in first.", { status: 401 });
  const b = await claimBill(me, (await params).id);
  if (!b) return new Response("Not found.", { status: 404 });
  return new Response(new Uint8Array(b.bytes), { headers: { "content-type": b.type, "content-disposition": `inline; filename="${b.name.replace(/"/g, "")}"`, "x-content-type-options": "nosniff", "cache-control": "private, no-store" } });
}
