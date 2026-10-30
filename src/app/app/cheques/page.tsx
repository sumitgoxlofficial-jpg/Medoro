import { redirect } from "next/navigation";
import { can, requireCtx } from "@/server/context";
import { listCheques } from "@/domain/parties/cheques";
import { PageHead } from "@/components/page-head";
import { t } from "@/lib/i18n";
import { todayISO } from "@/lib/dates";
import { ChequesView } from "./view";

export const metadata = { title: "Cheques" };

export default async function Page() {
  const ctx = await requireCtx();
  if (!can(ctx, "payments") && !can(ctx, "reports")) redirect("/app");
  return (
    <>
      <PageHead title={t(ctx.lang).chq} sub="Cheques from customers and to suppliers, including post-dated cheques. Record new ones from Suppliers & customers." />
      <ChequesView cheques={await listCheques(ctx)} canAct={can(ctx, "payments") && !ctx.readOnly} today={todayISO()} />
    </>
  );
}
