import { requireGrowth } from "@/staff/growth/access";
import { listLeads } from "@/staff/growth/leads";
import { OBJECTIONS, OBJECTION_LABEL } from "@/staff/growth/ai";
import { AiView } from "./view";

export default async function AiPage({ searchParams }: { searchParams: Promise<{ lead?: string; q?: string }> }) {
  const a = await requireGrowth("ai.use");
  const sp = await searchParams;
  const leads = await listLeads(a, { q: sp.q, pageSize: 20, sort: a.growthRole === "sales" ? "followup" : "score" });
  return <AiView leadId={sp.lead ?? null} q={sp.q ?? ""} leads={leads.rows.map((r) => ({ id: r.id, name: r.name, city: r.city }))} objections={(Object.keys(OBJECTIONS) as (keyof typeof OBJECTIONS)[]).map((k) => ({ key: k, label: OBJECTION_LABEL[k], ...OBJECTIONS[k] }))} />;
}
