import { growthApi, query } from "@/staff/growth/api";
import { exportLeads } from "@/staff/growth/leads";

export const dynamic = "force-dynamic";
/** CSV of the leads matching the filters; ?purpose= is required and audited. */
export const GET = (req: Request) => growthApi(req, "leads.export", async (a) => {
  const { purpose = "", ...filter } = query(req);
  const r = await exportLeads(a, filter, purpose);
  return new Response(r.csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="medoro-leads-${new Date().toISOString().slice(0, 10)}.csv"`, "Cache-Control": "no-store", "X-Row-Count": String(r.count) } });
});
