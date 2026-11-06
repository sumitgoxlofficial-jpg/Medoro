import { assignableStaff, can, requireGrowth } from "@/staff/growth/access";
import { board } from "@/staff/growth/pipeline";
import { PipelineView } from "./view";

export default async function Pipeline({ searchParams }: { searchParams: Promise<{ staffId?: string; state?: string; view?: string }> }) {
  const a = await requireGrowth("leads.view");
  const sp = await searchParams;
  const [b, staff] = await Promise.all([board(a, { staffId: sp.staffId || undefined, state: sp.state || undefined }), can(a, "assign") ? assignableStaff(a) : Promise.resolve([])]);
  return <PipelineView board={JSON.parse(JSON.stringify(b))} staff={staff} staffId={sp.staffId ?? ""} view={sp.view === "table" ? "table" : "kanban"} canEdit={can(a, "leads.edit")} />;
}
