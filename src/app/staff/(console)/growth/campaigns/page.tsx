import { can, requireGrowth } from "@/staff/growth/access";
import { campaigns, templates } from "@/staff/growth/comms";
import { INDIAN_STATES } from "@/staff/growth/constants";
import { CampaignsView } from "./view";

export default async function Campaigns() {
  const a = await requireGrowth("campaigns.manage");
  const [c, t] = await Promise.all([campaigns(a), templates()]);
  return <CampaignsView campaigns={JSON.parse(JSON.stringify(c))} templates={t.map((x) => ({ id: x.id, channel: x.channel, name: x.name, language: x.language, status: x.status }))} states={[...INDIAN_STATES]} canApprove={can(a, "campaigns.approve")} me={a.id} />;
}
