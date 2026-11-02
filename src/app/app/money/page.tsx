import Link from "next/link";
import { redirect } from "next/navigation";
import { can, requireCtx } from "@/server/context";
import { db } from "@/server/db";
import { driveModeOn } from "@/domain/system/drive-mode";
import { financeCounts } from "@/domain/reports/alerts";
import { billMatching } from "@/domain/finance/bills";
import { BillsView } from "./bills-view";
import { listConnections, providersView, syncHistory } from "@/domain/finance/connections";
import { ConnectionsPanel } from "@/components/fin-connections";
import { PageHead } from "@/components/page-head";
import { Card, CardHead } from "@/components/ui/card";
import { t } from "@/lib/i18n";

export const metadata = { title: "UPI & Bank Connect" };

/**
 * UPI & Bank Connect. Drive pharmacies reconcile on their counters (the data lives there); a pharmacy whose data is
 * on this server uses statement import and bank reconciliation here. Connections are listed with where they stand.
 */
export default async function Page({ searchParams }: { searchParams: Promise<{ connected?: string; connectError?: string }> }) {
  const ctx = await requireCtx();
  if (!can(ctx, "payments") && !can(ctx, "reports")) redirect("/app");
  const drive = !!ctx.mustMove || !!ctx.moved || (await driveModeOn(ctx.tenantId));
  const counts = drive ? await financeCounts(ctx.tenantId) : null;
  const bills = drive ? null : await billMatching(ctx);
  const conn = { providers: providersView(), connections: await listConnections(ctx), history: await syncHistory(ctx) };
  const sp = await searchParams;
  const [lines, open, last] = drive ? [0, 0, null] : await Promise.all([
    db.bankLine.count({ where: { tenantId: ctx.tenantId } }),
    db.bankLine.count({ where: { tenantId: ctx.tenantId, ledgerLineId: null } }),
    db.bankStatement.findFirst({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: "desc" }, select: { createdAt: true, fileName: true } }),
  ]);
  return (
    <>
      <PageHead title={t(ctx.lang).money} sub="Keep your bank, UPI ID and QR code. Medoro reads your bank statement and tells you which bills and counter UPI payments the bank confirms." />
      <div className="flex flex-col gap-4 max-w-[1100px]">
        {sp.connected ? <div className="rounded-lg border border-[#BFE3CF] bg-[#E6F4EC] px-4 py-2 text-sm">{sp.connected} is connected. The first sync is queued.</div> : null}
        {sp.connectError ? <div className="rounded-lg border border-[#F2C4BF] bg-[#FBEAE8] px-4 py-2 text-sm">Not connected: {sp.connectError.slice(0, 200)}</div> : null}
        {drive ? (
          <Card className="p-4 flex flex-col gap-2">
            <CardHead title="Your records live on your counters" />
            <div className="text-sm">Upload statements, review matches and see reports under <b>Billing (device) → UPI &amp; Bank</b>. Statements are read on the counter and kept in your Google Drive; they are not sent to Medoro.</div>
            {counts ? (
              <div className="text-sm">Your counters last reported ({counts.at.toLocaleString("en-IN")}): <b className={counts.notSeen ? "text-bad" : ""}>{counts.notSeen} counter UPI payment(s) not in the bank statement</b>, {counts.review} possible duplicate(s), {counts.unmatched} unmatched credit(s){counts.statementTo ? `; statements up to ${counts.statementTo}` : ""}. Only these numbers reach Medoro, for your daily email.</div>
            ) : null}
            <Link href="/app/device-pos" className="text-teal text-sm font-medium">Open Billing (device)</Link>
          </Card>
        ) : (
          <Card className="p-4 flex flex-col gap-2">
            <CardHead title="Bank statements" />
            <div className="text-sm">{lines ? `${lines} statement line(s) imported, ${open} not yet matched to your books.` : "No statements imported yet."}{last ? ` Last upload: ${last.fileName}, ${last.createdAt.toLocaleString("en-IN")}.` : ""}</div>
            <Link href="/app/bank" className="text-teal text-sm font-medium">Upload a statement or open bank reconciliation</Link>
          </Card>
        )}
        {bills && <BillsView data={bills} canAct={can(ctx, "payments") && !ctx.readOnly && !ctx.locked} />}
        <ConnectionsPanel initial={conn} canManage={can(ctx, "integrations") && !ctx.readOnly} />
        <div className="text-[12.5px] text-muted">Medoro never asks for your net-banking password, UPI PIN or OTP, and never moves money. A connection is shown as working only after the bank or provider confirms it for your account.</div>
      </div>
    </>
  );
}
