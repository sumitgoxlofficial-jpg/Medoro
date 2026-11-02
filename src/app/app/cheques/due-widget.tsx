import Link from "next/link";
import { can, type Ctx } from "@/server/context";
import { dueCheques } from "@/domain/parties/cheques";
import { todayISO } from "@/lib/dates";
import { T } from "@/lib/i18n-client";
import { ChequeTable } from "./view";

/** Dashboard card: open cheques dated within the next three days (deposit them, or keep funds for issued ones). */
export async function DueCheques({ ctx }: { ctx: Ctx }) {
  if (!can(ctx, "payments")) return null;
  const rows = await dueCheques(ctx, 3);
  if (!rows.length) return null;
  return (
    <div className="max-w-[1400px] mt-4 flex flex-col gap-2">
      <div className="flex items-baseline gap-3"><span className="font-semibold text-[15px]"><T>Cheques due</T></span><span className="text-[12.5px] text-faint"><T>dated up to 3 days ahead</T></span><Link href="/app/cheques" className="ml-auto text-[13px] text-teal font-medium"><T>All cheques →</T></Link></div>
      <ChequeTable rows={rows} canAct={!ctx.readOnly} today={todayISO()} compact />
    </div>
  );
}
