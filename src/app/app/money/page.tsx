import Link from "next/link";
import { redirect } from "next/navigation";
import { can, requireCtx } from "@/server/context";
import { db } from "@/server/db";
import { driveModeOn } from "@/domain/system/drive-mode";
import { LABEL_TEXT, SOURCES, type SourceLabel } from "@/domain/finance/providers";
import { PageHead } from "@/components/page-head";
import { Badge, type Tone } from "@/components/ui/badge";
import { Card, CardHead } from "@/components/ui/card";
import { t } from "@/lib/i18n";
import { localeOf, tFor } from "@/lib/tr";

export const metadata = { title: "UPI & Bank Connect" };
const TONE: Record<SourceLabel, Tone> = { available: "green", sandbox: "blue", partner_required: "amber", unsupported: "gray" };

/**
 * UPI & Bank Connect. Drive pharmacies reconcile on their counters (the data lives there); a pharmacy whose data is
 * on this server uses statement import and bank reconciliation here. Connections are listed with where they stand.
 */
export default async function Page() {
  const ctx = await requireCtx();
  if (!can(ctx, "payments") && !can(ctx, "reports")) redirect("/app");
  const tr = tFor(ctx.lang);
  const drive = !!ctx.mustMove || !!ctx.moved || (await driveModeOn(ctx.tenantId));
  const [lines, open, last] = drive ? [0, 0, null] : await Promise.all([
    db.bankLine.count({ where: { tenantId: ctx.tenantId } }),
    db.bankLine.count({ where: { tenantId: ctx.tenantId, ledgerLineId: null } }),
    db.bankStatement.findFirst({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: "desc" }, select: { createdAt: true, fileName: true } }),
  ]);
  return (
    <>
      <PageHead title={t(ctx.lang).money} sub="Keep your bank, UPI ID and QR code. Medoro reads your bank statement and tells you which bills and counter UPI payments the bank confirms." />
      <div className="flex flex-col gap-4 max-w-[1100px]">
        {drive ? (
          <Card className="p-4 flex flex-col gap-2">
            <CardHead title="Your records live on your counters" />
            <div className="text-sm">{tr("Upload statements, review matches and see reports under")} <b>{tr("Billing (device) → UPI & Bank")}</b>. {tr("Statements are read on the counter and kept in your Google Drive; they are not sent to Medoro.")}</div>
            <Link href="/app/device-pos" className="text-teal text-sm font-medium">{tr("Open Billing (device)")}</Link>
          </Card>
        ) : (
          <Card className="p-4 flex flex-col gap-2">
            <CardHead title="Bank statements" />
            <div className="text-sm">{lines ? tr("{n} statement line(s) imported, {open} not yet matched to your books.", { n: lines, open }) : tr("No statements imported yet.")}{last ? ` ${tr("Last upload: {file}, {at}.", { file: last.fileName, at: last.createdAt.toLocaleString(localeOf(ctx.lang)) })}` : ""}</div>
            <Link href="/app/bank" className="text-teal text-sm font-medium">{tr("Open bank reconciliation")}</Link>
          </Card>
        )}
        <div className="grid gap-4 lg:grid-cols-2">
          {(["bank", "provider"] as const).map((kind) => (
            <Card key={kind} className="p-4 flex flex-col gap-2">
              <CardHead title={kind === "bank" ? "Bank connections" : "Payment providers"} />
              <ul className="flex flex-col gap-2">
                {SOURCES.filter((s) => s.kind === kind).map((s) => (
                  <li key={s.id} className="border border-line rounded-lg p-3 flex flex-col gap-1">
                    <div className="flex justify-between items-center gap-2 flex-wrap"><span className="font-medium">{tr(s.name)}</span><Badge tone={TONE[s.label]}>{tr(LABEL_TEXT[s.label])}</Badge></div>
                    <div className="text-sm">{tr(s.today)}</div>
                    <div className="text-[12.5px] text-muted">{tr("Timing: {delay}", { delay: tr(s.delay) })}</div>
                  </li>
                ))}
              </ul>
            </Card>
          ))}
        </div>
        <div className="text-[12.5px] text-muted">{tr("Medoro never asks for your net-banking password, UPI PIN or OTP, and never moves money. A connection is shown as working only after the bank or provider confirms it for your account.")}</div>
      </div>
    </>
  );
}
