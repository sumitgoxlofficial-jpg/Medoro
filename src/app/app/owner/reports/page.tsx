import { redirect } from "next/navigation";
import { can, requireCtx } from "@/server/context";
import { reportMailView } from "@/domain/reports/mailer";
import { PageHead } from "@/components/page-head";
import { ReportMailForm } from "./view";

export const metadata = { title: "Scheduled reports" };

export default async function Page() {
  const ctx = await requireCtx();
  if (!can(ctx, "reports")) redirect("/app");
  const s = await reportMailView(ctx);
  return (
    <>
      <PageHead title="Scheduled reports" sub="Email the daily or weekly numbers with CSV attachments to you and your accountant" />
      <ReportMailForm initial={s} canEdit={can(ctx, "users") && !ctx.readOnly} />
    </>
  );
}
