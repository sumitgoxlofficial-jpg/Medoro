import { requireGrowth } from "@/staff/growth/access";
import { importHistory } from "@/staff/growth/imports";
import { OSM_ATTRIBUTION, osmEnabled, overpassUrl } from "@/staff/growth/discovery";
import { DiscoveryView } from "./view";

export const maxDuration = 120;

export default async function Discovery() {
  const a = await requireGrowth("leads.discover");
  const jobs = (await importHistory(a)).filter((j) => j.fileName.startsWith("OpenStreetMap"));
  return <DiscoveryView jobs={JSON.parse(JSON.stringify(jobs))} enabled={osmEnabled()} endpoint={new URL(overpassUrl()).host} attribution={OSM_ATTRIBUTION} />;
}
