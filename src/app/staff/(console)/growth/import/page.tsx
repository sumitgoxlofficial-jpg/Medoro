import { requireGrowth } from "@/staff/growth/access";
import { importHistory } from "@/staff/growth/imports";
import { db } from "@/server/db";
import { ImportView } from "./view";

export const maxDuration = 120;

export default async function ImportPage() {
  const a = await requireGrowth("leads.import");
  const [jobs, sources] = await Promise.all([importHistory(a), db.leadSource.findMany({ where: { active: true, kind: { not: "open_data" } }, orderBy: { name: "asc" }, select: { id: true, name: true, kind: true } })]);
  return <ImportView jobs={JSON.parse(JSON.stringify(jobs.filter((j) => !j.fileName.startsWith("OpenStreetMap"))))} sources={sources} />;
}
