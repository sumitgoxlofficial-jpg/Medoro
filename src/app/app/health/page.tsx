import { redirect } from "next/navigation";
import { Activity } from "lucide-react";
import { requireCtx, can } from "@/server/context";
import { healthOverview } from "@/domain/system/health";
import { PageHead } from "@/components/page-head";
import { HealthView } from "./view";

export const metadata = { title: "Integration health" };

export default async function Page() {
  const ctx = await requireCtx();
  if (!can(ctx, "integrations")) redirect("/app");
  const rows = await healthOverview(ctx);
  return (
    <>
      <PageHead icon={Activity} title="Integration health" sub="What is connected, what has genuinely been tested, and what has failed. Active appears only after a passing test and real use." />
      <HealthView rows={rows} canTest={!ctx.readOnly} />
    </>
  );
}
