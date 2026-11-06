import { z } from "zod";
import { body, growthApi } from "@/staff/growth/api";
import { checkWebsite, markInvalid, verifyLead } from "@/staff/growth/verify";

export const dynamic = "force-dynamic";
const schema = z.object({ leadId: z.string().uuid(), action: z.enum(["verify", "website_check", "invalid", "clear_invalid"]).default("verify"), kind: z.string().optional(), method: z.string().optional(), detail: z.string().optional(), url: z.string().optional(), reason: z.string().optional() });
export const POST = (req: Request) => growthApi(req, "leads.verify", async (a) => {
  const i = await body(req, schema);
  if (i.action === "website_check") return checkWebsite(a, i.leadId);
  if (i.action === "invalid") { await markInvalid(a, i.leadId, i.reason ?? ""); return {}; }
  if (i.action === "clear_invalid") { await markInvalid(a, i.leadId, null); return {}; }
  await verifyLead(a, i.leadId, { kind: i.kind as "business", method: i.method ?? "", detail: i.detail ?? "", url: i.url ?? "" });
  return {};
});
