import { redirect } from "next/navigation";
import { requireCtx, can } from "@/server/context";
import { UserError } from "@/server/action";
import { defaultPeriod, doctorSales, listDoctors } from "@/domain/doctors/service";
import { PageHead } from "@/components/page-head";
import { t } from "@/lib/i18n";
import { DoctorsView } from "./view";

export const metadata = { title: "Doctors" };

export default async function Page({ searchParams }: { searchParams: Promise<{ tab?: string; from?: string; to?: string; branch?: string; q?: string }> }) {
  const ctx = await requireCtx();
  if (!can(ctx, "sale") && !can(ctx, "reports")) redirect("/app");
  const sp = await searchParams;
  const canReport = can(ctx, "reports");
  const tab = sp.tab === "report" && canReport ? "report" : "master";
  const def = defaultPeriod();
  const branch = sp.branch === "all" || ctx.branches.some((b) => b.id === sp.branch) ? sp.branch! : ctx.branchId;
  let report = null;
  if (tab === "report") {
    try { report = await doctorSales(ctx, sp.from ?? def.from, sp.to ?? def.to, branch); } catch (e) { if (!(e instanceof UserError)) throw e; report = await doctorSales(ctx, def.from, def.to, branch); }
  }
  const doctors = await listDoctors(ctx, { all: true, q: sp.q });
  return (
    <>
      <PageHead title={t(ctx.lang).doc} sub="Doctor master for prescriptions, and sales by referring doctor" />
      <DoctorsView tab={tab} doctors={doctors} q={sp.q ?? ""} report={report} branches={ctx.branches.map((b) => ({ id: b.id, name: b.name }))}
        canReport={canReport} canEdit={can(ctx, "adjust") || can(ctx, "users") || canReport} />
    </>
  );
}
