import { can, requireGrowth } from "@/staff/growth/access";
import { integrations, templates } from "@/staff/growth/comms";
import { TemplatesView } from "./templates";

export default async function WhatsApp() {
  const a = await requireGrowth("campaigns.manage");
  const [i, t] = await Promise.all([integrations(), templates("whatsapp")]);
  const w = i.whatsapp;
  return (
    <>
      <section className="bg-white border border-[#E6E8EB] rounded-xl p-4 text-[13.5px] flex flex-col gap-1">
        <strong className="text-[14.5px]">WhatsApp Business Platform (Cloud API)</strong>
        {w?.status === "connected" ? <span>Connected · number {w.config.displayNumber || w.config.phoneNumberId} · WABA {w.config.wabaId}</span> : <span className="text-[#94570A]">Not connected. {can(a, "integrations.manage") ? "Connect it under Integrations." : "Ask a super admin to connect it."}</span>}
        <span className="text-muted text-[12.5px]">Official API only. Business-initiated messages use Meta-approved templates; free text is possible only within 24 hours of the pharmacy’s last message. STOP replies opt the number out automatically.</span>
      </section>
      <TemplatesView channel="whatsapp" templates={JSON.parse(JSON.stringify(t))} canApprove={false} connected={w?.status === "connected"} />
    </>
  );
}
