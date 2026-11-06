import { can, requireGrowth } from "@/staff/growth/access";
import { integrations, templates } from "@/staff/growth/comms";
import { TemplatesView } from "../whatsapp/templates";
import { EmailSender } from "./sender";

export default async function Email() {
  const a = await requireGrowth("campaigns.manage");
  const [i, t] = await Promise.all([integrations(), templates("email")]);
  return (
    <>
      <EmailSender status={i.email?.status ?? null} config={i.email?.config ?? null} provider={i.mailProvider} canManage={can(a, "integrations.manage")} />
      <TemplatesView channel="email" templates={JSON.parse(JSON.stringify(t))} canApprove={can(a, "campaigns.approve")} connected={i.email?.status === "connected"} />
      <section className="text-[12.5px] text-muted px-1">Bounces, complaints and replies arrive at <code>/api/growth/email/events</code> (signed with <code>GROWTH_EMAIL_WEBHOOK_SECRET</code>) and update the do-not-contact list and the inbox.</section>
    </>
  );
}
