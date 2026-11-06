import { can, requireGrowth } from "@/staff/growth/access";
import { leadDetail } from "@/staff/growth/leads";
import { templates } from "@/staff/growth/comms";
import { openCalls } from "@/staff/growth/calls";
import { LeadDetailView } from "./view";

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const a = await requireGrowth("leads.view");
  const { id } = await params;
  const [d, tpl, open] = await Promise.all([leadDetail(a, id), can(a, "messages.send") ? templates() : Promise.resolve([]), openCalls(a)]);
  const j = JSON.parse(JSON.stringify(d)); // dates become strings for the client
  return (
    <LeadDetailView
      d={j}
      me={a.id}
      openSession={open.find((o) => o.leadId === id)?.id ?? null}
      templates={tpl.filter((t) => t.status === "approved").map((t) => ({ id: t.id, channel: t.channel, name: t.name, language: t.language }))}
      can={{ edit: can(a, "leads.edit"), verify: can(a, "leads.verify"), consent: can(a, "consent.record"), send: can(a, "messages.send"), erase: can(a, "compliance.manage"), call: can(a, "calls.make"), ai: can(a, "ai.use"), admin: a.growthRole === "admin" }}
    />
  );
}
