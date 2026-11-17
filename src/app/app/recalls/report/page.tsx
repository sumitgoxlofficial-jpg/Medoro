import Link from "next/link";
import { redirect } from "next/navigation";
import { ShieldAlert } from "lucide-react";
import { requireCtx, can } from "@/server/context";
import { db } from "@/server/db";
import { recallSettings } from "@/domain/inventory/recalls";
import { PageHead } from "@/components/page-head";
import { NoticeForm, SettingToggle } from "../report-forms";

export const metadata = { title: "Recall reports" };
const card = "bg-white border border-line rounded-xl p-4";

export default async function Page() {
  const ctx = await requireCtx();
  if (!(can(ctx, "adjust") || can(ctx, "users") || can(ctx, "reports"))) redirect("/app");
  const [rows, s] = await Promise.all([db.recall.findMany({ where: { tenantId: ctx.tenantId }, orderBy: { createdAt: "desc" }, take: 100 }), recallSettings(ctx.tenantId)]);
  const canRecord = (can(ctx, "adjust") || can(ctx, "users")) && !ctx.readOnly;
  return (
    <>
      <PageHead icon={ShieldAlert} title="Recall reports" sub="Trace, dispose and resolve recall notices. Notices are entered by you from the authority’s own publication; no government feed is connected." />
      <div className="max-w-[1400px] flex flex-col gap-4">
        {can(ctx, "users") && !ctx.readOnly ? <section className={card} data-testid="recall-settings"><SettingToggle on={s.autoQuarantine} /></section> : null}
        <section className={card} data-testid="recall-list">
          <h2 className="m-0 mb-2 text-[15px] font-semibold">Notices</h2>
          {rows.length ? <ul className="m-0 p-0 list-none grid gap-1 text-[13px]">{rows.map((r) => <li key={r.id}><Link href={`/app/recalls/${r.id}`} className="underline">{r.sourceRef}</Link> · {r.product} · {r.status}{r.noticeNo ? ` · notice ${r.noticeNo}` : ""} · published {r.publishedAt.toISOString().slice(0, 10)}</li>)}</ul> : <p className="m-0 text-[13px] text-slate-500">No recall notices recorded.</p>}
          <p className="m-0 mt-2 text-[12px] text-slate-500">To record a notice for one of your catalogue medicines, use <Link href="/app/recalls" className="underline">Recalls &amp; alerts</Link>.</p>
        </section>
        {canRecord ? <section className={card}><h2 className="m-0 mb-2 text-[15px] font-semibold">Record a notice by manufacturer and product</h2><p className="m-0 mb-2 text-[12px] text-slate-500">Matches batches whose medicine’s manufacturer contains the name you enter and whose name or generic contains the product text, with the batch number on the notice. Check the matches in the report afterwards.</p><NoticeForm /></section> : null}
      </div>
    </>
  );
}
