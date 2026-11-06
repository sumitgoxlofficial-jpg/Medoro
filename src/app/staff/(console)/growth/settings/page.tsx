import { requireGrowth } from "@/staff/growth/access";
import { policy } from "@/staff/growth/compliance";
import { db } from "@/server/db";
import { SettingsView } from "./view";

export default async function Settings() {
  await requireGrowth("settings.manage");
  const [p, sources] = await Promise.all([policy(), db.leadSource.findMany({ orderBy: { name: "asc" } })]);
  return <SettingsView policy={p} sources={JSON.parse(JSON.stringify(sources))} />;
}
