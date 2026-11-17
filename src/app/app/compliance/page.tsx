import { redirect } from "next/navigation";
import { FileCheck } from "lucide-react";
import { requireCtx, can } from "@/server/context";
import { complianceOverview } from "@/domain/system/compliance";
import { PageHead } from "@/components/page-head";
import { ActiveButton, CloseForm, InspectionForm, ItemForm, SettingsForm, UploadForm } from "./forms";

export const metadata = { title: "Compliance centre" };
const card = "bg-white border border-line rounded-xl p-4";
const TONE: Record<string, string> = { ok: "bg-emerald-50 text-emerald-800 border-emerald-200", attention: "bg-amber-50 text-amber-800 border-amber-200", critical: "bg-red-50 text-red-800 border-red-200" };
const LEVEL: Record<string, string> = { ok: "In order", attention: "Needs attention", critical: "Action needed" };
const ST: Record<string, string> = { valid: "Valid", expiring: "Renewal due", expired: "Expired", no_expiry: "No expiry" };
const OUT: Record<string, string> = { no_findings: "No findings", observations: "Observations", non_compliance: "Non-compliance noted" };

export default async function Page() {
  const ctx = await requireCtx();
  if (!(can(ctx, "adjust") || can(ctx, "users") || can(ctx, "reports"))) redirect("/app");
  const d = await complianceOverview(ctx);
  const write = (can(ctx, "adjust") || can(ctx, "users")) && !ctx.readOnly && !ctx.moved;
  const branches = ctx.branches.map((b) => ({ id: b.id, name: b.name }));
  return (
    <>
      <PageHead icon={FileCheck} title="Compliance centre" sub="Licences, pharmacist registration, inspections and renewal reminders, kept in your own records" />
      <div className="max-w-[1400px] flex flex-col gap-4">
        <p className="m-0 text-[12.5px] text-slate-600 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2" data-testid="compliance-disclaimer">
          This is a record-keeping and reminder tool. It does not tell you what the law requires of your pharmacy, it does not check anything with a licensing authority, and its requirements and retention periods are whatever you configure here. Have them confirmed by a qualified regulatory professional.
        </p>

        <section className={card} data-testid="compliance-branches">
          <h2 className="m-0 mb-2 text-[15px] font-semibold">Branch status</h2>
          <div className="grid gap-2">{d.branches.map((b) => (
            <div key={b.branchId} className="flex flex-col gap-0.5"><div className="flex items-center gap-2"><strong className="text-[14px]">{b.branch}</strong><span className={`text-[12px] rounded-full border px-2 py-0.5 ${TONE[b.level]}`} data-testid={`branch-level-${b.branch}`}>{LEVEL[b.level]}</span></div>
              {b.reasons.length ? <ul className="m-0 pl-5 text-[12.5px] text-slate-700">{b.reasons.map((r, i) => <li key={i}>{r}</li>)}</ul> : <span className="text-[12.5px] text-slate-500">Nothing missing, expiring or open against your configured requirements.</span>}
              <span className="text-[12px] text-slate-500">Schedule H1/X sale lines, last 90 days: {b.h1.lines}</span></div>))}</div>
        </section>

        <section className={card} data-testid="compliance-items">
          <h2 className="m-0 mb-2 text-[15px] font-semibold">Licences and registrations</h2>
          {d.items.length ? <div className="grid gap-3">{d.items.map((i) => (
            <article key={i.id} className={`border-t border-line pt-2 ${i.active ? "" : "opacity-60"}`} data-testid="compliance-item">
              <div className="flex items-center gap-2 flex-wrap"><strong className="text-[14px]">{i.title}</strong><span className="text-[12px] rounded-full border border-line px-2 py-0.5">{ST[i.status]}{i.daysLeft != null ? ` · ${i.daysLeft < 0 ? `${-i.daysLeft} d ago` : `${i.daysLeft} d`}` : ""}</span>{!i.active ? <span className="text-[12px] text-slate-500">switched off</span> : null}</div>
              <div className="text-[12.5px] text-slate-600">{i.kindLabel} · {i.branch}{i.number ? ` · no. ${i.number}` : ""}{i.holder ? ` · ${i.holder}` : ""}{i.authority ? ` · ${i.authority}` : ""}{i.expiresOn ? ` · expires ${i.expiresOn}` : ""} · reminders at {i.remindDays.join(", ")} days</div>
              {i.documents.length ? <ul className="m-0 mt-1 pl-5 text-[12.5px]">{i.documents.map((x) => <li key={x.id}><a href={`/api/compliance/${x.id}`} target="_blank" rel="noopener noreferrer" className="underline">{x.title}</a> <span className="text-slate-500">({x.fileName})</span></li>)}</ul> : null}
              {write ? <div className="mt-1 grid gap-2"><UploadForm itemId={i.id} kind="licence_copy" /><details><summary className="cursor-pointer text-[12.5px] underline">Edit or renew</summary><div className="mt-2"><ItemForm branches={branches} kinds={d.kinds} edit={i} /></div></details><ActiveButton id={i.id} active={i.active} /></div> : null}
            </article>))}</div> : <p className="m-0 text-[13px] text-slate-500">No licence or registration recorded yet.</p>}
          {write ? <details className="mt-3"><summary className="cursor-pointer text-[13px] font-medium underline">Add a licence or registration</summary><div className="mt-2"><ItemForm branches={branches} kinds={d.kinds} /></div></details> : null}
        </section>

        <section className={card} data-testid="compliance-inspections">
          <h2 className="m-0 mb-2 text-[15px] font-semibold">Inspections</h2>
          {d.inspections.length ? <div className="grid gap-2">{d.inspections.map((i) => (
            <article key={i.id} className="border-t border-line pt-2">
              <div className="text-[13px]"><strong>{i.inspectedOn}</strong> · {i.branch} · {i.authority}{i.inspector ? ` (${i.inspector})` : ""} · {OUT[i.outcome]}{i.closedOn ? ` · closed ${i.closedOn}` : i.open ? (i.overdue ? " · open, past its action date" : i.actionDue ? ` · open, due ${i.actionDue}` : " · open") : ""}</div>
              <div className="text-[12.5px] text-slate-700">{i.findings}{i.closingNote ? ` → ${i.closingNote}` : ""}</div>
              {write ? <div className="mt-1 grid gap-1">{i.open ? <CloseForm id={i.id} /> : null}<UploadForm inspectionId={i.id} kind="inspection_report" /></div> : null}
            </article>))}</div> : <p className="m-0 text-[13px] text-slate-500">No inspection recorded.</p>}
          {write ? <details className="mt-3"><summary className="cursor-pointer text-[13px] font-medium underline">Record an inspection</summary><div className="mt-2"><InspectionForm branches={branches} outcomes={d.outcomes} /></div></details> : null}
        </section>

        <section className={card} data-testid="compliance-retention">
          <h2 className="m-0 mb-1 text-[15px] font-semibold">Record retention</h2>
          <p className="m-0 mb-2 text-[12.5px] text-slate-600">Periods you configured: {d.retention.configured.length ? d.retention.configured.map((r) => `${r.label}${r.years != null ? `, ${r.years} years` : ""}${r.note ? ` (${r.note})` : ""}`).join("; ") : "none yet. Medoro does not assume any."}</p>
          <p className="m-0 mb-1 text-[12.5px] text-slate-600">What the system itself already does (its daily clean-up leaves statutory books such as sales, ledgers, stock movements, GRNs and the audit trail untouched):</p>
          <ul className="m-0 pl-5 text-[12.5px] text-slate-700">{d.retention.system.map((r) => <li key={r.label}>{r.label}: {r.action}</li>)}</ul>
        </section>

        {can(ctx, "users") && write ? <section className={card}><h2 className="m-0 mb-2 text-[15px] font-semibold">Requirements and retention settings</h2><SettingsForm kinds={d.kinds} required={d.settings.required} retention={d.settings.retention} isDefault={d.settings.requiredIsDefault} /></section> : null}
      </div>
    </>
  );
}
