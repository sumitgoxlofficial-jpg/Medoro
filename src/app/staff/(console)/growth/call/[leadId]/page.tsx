import { requireGrowth } from "@/staff/growth/access";
import { leadDetail } from "@/staff/growth/leads";
import { openCalls } from "@/staff/growth/calls";
import { recommendFollowUp } from "@/staff/growth/ai";
import { db } from "@/server/db";
import { Workspace } from "./workspace";

export default async function CallWorkspace({ params }: { params: Promise<{ leadId: string }> }) {
  const a = await requireGrowth("calls.make");
  const { leadId } = await params;
  const [d, open, asg] = await Promise.all([leadDetail(a, leadId), openCalls(a), db.leadAssignment.findFirst({ where: { leadId, staffId: a.id, active: true } })]);
  const reported = d.calls.filter((c) => c.outcome).map((c) => ({ outcome: c.outcome, at: c.reportedAt! }));
  const rec = recommendFollowUp(reported, d.demos.map((x) => x.status), d.lead.stage);
  const l = d.lead;
  return (
    <Workspace
      lead={{ id: l.id, code: l.code, name: l.name, phone: l.phone, phoneRaw: l.phoneRaw, owner: l.ownerVerified ? l.ownerName : "", address: l.address, city: l.city, district: l.district, state: l.state, pin: l.pin, stage: l.stage, verification: l.verification, source: d.source?.name ?? "", nextFollowUpAt: l.nextFollowUpAt?.toISOString() ?? null, assignedAt: asg?.assignedAt.toISOString() ?? null, dueAt: asg?.dueAt?.toISOString() ?? null }}
      mine={!!asg}
      openSession={open.find((o) => o.leadId === leadId)?.id ?? null}
      calls={d.calls.slice(0, 10).map((c) => ({ id: c.id, at: (c.reportedAt ?? c.launchedAt).toISOString(), by: c.staffName, outcome: c.outcome, notes: c.notes }))}
      recommendation={rec}
    />
  );
}
