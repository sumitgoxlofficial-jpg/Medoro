import { headers } from "next/headers";
import { requireGrowth } from "@/staff/growth/access";
import { integrations } from "@/staff/growth/comms";
import { jobList } from "@/staff/growth/jobs";
import { osmEnabled, overpassUrl } from "@/staff/growth/discovery";
import { resolveProvider } from "@/domain/ai/llm";
import { IntegrationsView } from "./view";

export default async function Integrations() {
  await requireGrowth("integrations.manage");
  const [i, jobs] = await Promise.all([integrations(), jobList()]);
  const h = await headers();
  const origin = process.env.APP_URL?.replace(/\/$/, "") ?? `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;
  const ai = resolveProvider(process.env, { strict: false, remoteAi: process.env.GROWTH_REMOTE_AI === "1" });
  return <IntegrationsView i={JSON.parse(JSON.stringify(i))} jobs={JSON.parse(JSON.stringify(jobs))} webhook={`${origin}/api/growth/wa/webhook`} osm={{ enabled: osmEnabled(), host: new URL(overpassUrl()).host }} ai={{ mode: ai.mode, note: ai.note ?? "" }} emailWebhook={!!process.env.GROWTH_EMAIL_WEBHOOK_SECRET} />;
}
