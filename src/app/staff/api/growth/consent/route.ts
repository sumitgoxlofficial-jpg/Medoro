import { z } from "zod";
import { db } from "@/server/db";
import { body, growthApi, query } from "@/staff/growth/api";
import { findLead } from "@/staff/growth/access";
import { recordConsent, revokeConsent } from "@/staff/growth/compliance";

export const dynamic = "force-dynamic";
export const GET = (req: Request) => growthApi(req, "consent.record", async (a) => {
  const { leadId } = z.object({ leadId: z.string().uuid() }).parse(query(req));
  await findLead(a, leadId);
  return { consents: await db.contactConsent.findMany({ where: { leadId }, orderBy: { grantedAt: "desc" } }) };
});
/** Record consent, or { revokeId, note } to revoke one. */
export const POST = (req: Request) => growthApi(req, "consent.record", async (a) => {
  const b = await body<Record<string, unknown>>(req);
  if (b.revokeId) { await revokeConsent(a, String(b.revokeId), String(b.note ?? "")); return {}; }
  return { id: await recordConsent(a, b as never) };
});
