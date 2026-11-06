import { assignableStaff, can, requireGrowth } from "@/staff/growth/access";
import { facets, listLeads } from "@/staff/growth/leads";
import { LeadsView } from "./view";

export default async function Leads({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const a = await requireGrowth("leads.view");
  const sp = await searchParams;
  const filter = { q: sp.q, state: sp.state, district: sp.district, city: sp.city, pin: sp.pin, verification: sp.verification, stage: sp.stage, staffId: sp.staffId, sourceId: sp.sourceId, website: sp.website, phone: (sp.phone as "yes" | "no" | undefined) || undefined, minScore: sp.minScore || undefined, page: sp.page ?? 1, sort: (sp.sort as "recent") ?? "recent" };
  const [list, f, staff] = await Promise.all([listLeads(a, filter), facets(a), can(a, "assign") ? assignableStaff(a) : Promise.resolve([])]);
  return <LeadsView list={list} facets={f} staff={staff} filter={sp} can={{ assign: can(a, "assign"), create: can(a, "leads.create"), export: can(a, "leads.export"), edit: can(a, "leads.edit") }} />;
}
