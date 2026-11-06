import { z } from "zod";
import { body, growthApi, query } from "@/staff/growth/api";
import { assignByTerritory, assignLeads, assignmentHistory, distribute, distributionOverview, reassignFrom, withdraw } from "@/staff/growth/distribution";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
export const GET = (req: Request) => growthApi(req, "assign", async (a) => { const q = query(req); return { overview: await distributionOverview(a), history: await assignmentHistory(a, { leadId: q.leadId, staffId: q.staffId }) }; });
/**
 * mode "assign": { leadIds | filter, staffId, dueAt?, reassign? } · "distribute": { leadIds | filter, staffIds, mode: equal|balance }
 * "territory": { state? } · "withdraw": { leadIds, reason } · "reassign_from": { fromStaffId, toStaffIds }
 */
export const POST = (req: Request) => growthApi(req, "assign", async (a) => {
  const b = await body<Record<string, unknown>>(req);
  switch (z.enum(["assign", "distribute", "territory", "withdraw", "reassign_from"]).parse(b.mode ?? "assign")) {
    case "assign": return assignLeads(a, b as never);
    case "distribute": return distribute(a, { ...b, mode: b.split ?? "equal" } as never);
    case "territory": return assignByTerritory(a, b as never);
    case "withdraw": return { withdrawn: await withdraw(a, b.leadIds as string[], String(b.reason ?? "")) };
    case "reassign_from": return reassignFrom(a, String(b.fromStaffId), b.toStaffIds as string[]);
  }
});
