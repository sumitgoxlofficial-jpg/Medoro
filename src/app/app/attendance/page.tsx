import { requireCtx } from "@/server/context";
import { canSeeTeam, monthOf, teamMonth, today } from "@/domain/identity/attendance";
import { todayISO } from "@/lib/dates";
import { PageHead } from "@/components/page-head";
import { t } from "@/lib/i18n";
import { AttendanceView } from "./view";

export const metadata = { title: "Staff attendance" };

export default async function Page({ searchParams }: { searchParams: Promise<{ m?: string; all?: string }> }) {
  const ctx = await requireCtx();
  const sp = await searchParams;
  const ym = /^\d{4}-(0[1-9]|1[0-2])$/.test(sp.m ?? "") ? sp.m! : todayISO().slice(0, 7);
  const team = canSeeTeam(ctx);
  const [now, mine, rows] = await Promise.all([today(ctx), monthOf(ctx, ym), team ? teamMonth(ctx, ym, sp.all === "1" ? "all" : ctx.branchId) : Promise.resolve(null)]);
  return (
    <>
      <PageHead title={t(ctx.lang).att} sub="Punch in when you start and out when you finish. Managers see the team and can fix a day." />
      <AttendanceView ym={ym} now={now} mine={mine} team={rows} all={sp.all === "1"} multiBranch={ctx.branches.length > 1} readOnly={!!ctx.readOnly} />
    </>
  );
}
