import Link from "next/link";
import { Download } from "lucide-react";
import type { h1Register } from "@/domain/accounting/reports";

const card = "bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)]";
const th = "text-left text-[12px] font-medium text-muted px-3 py-2.5 border-b border-[#E3E6E9] whitespace-nowrap";
const td = "px-3 py-2 border-b border-row align-top";
const PERIODS = [["month", "This month"], ["last", "Last month"], ["fy", "This financial year"]] as const;

/** Schedule H1 register for the current branch: screen view with a CSV download of the same rows. */
export function H1RegisterView({ rows, periodKey, branchName }: { rows: Awaited<ReturnType<typeof h1Register>>; periodKey: string; branchName: string }) {
  const missing = rows.filter((r) => !r.patient || !r.prescriber || !r.prescriberReg).length;
  return (
    <div className="flex flex-col gap-3.5 max-w-[1400px]">
      <div className="flex gap-2 items-center flex-wrap">
        <div className="inline-flex max-w-full overflow-x-auto [scrollbar-width:none] gap-px bg-chip p-0.5 rounded-lg">{PERIODS.map(([k, label]) => <Link key={k} href={`/app/accounts?view=h1&period=${k}`} aria-current={periodKey === k ? "page" : undefined} className={"flex-none whitespace-nowrap inline-flex items-center rounded-md h-7 max-md:h-9 px-3 text-[12.5px] font-medium no-underline " + (periodKey === k ? "bg-white text-ink shadow-[0_1px_2px_rgba(0,0,0,.1)]" : "text-muted hover:text-ink")}>{label}</Link>)}</div>
        <a href={`/api/reports/h1-register?period=${periodKey}`} className="ml-auto flex items-center gap-1 border border-input rounded-md px-2.5 py-1.5 text-[13px] text-ink hover:border-teal no-underline"><Download size={14} />CSV</a>
      </div>
      {missing ? <div role="note" className="bg-[#FDF2E1] border border-[#F3D9A8] rounded-[10px] px-3.5 py-2.5 text-[13px] text-[#6B4A0E]">{missing} line(s) lack the patient name, prescriber or registration number. Enter them on the bill at the counter for H1 medicines.</div> : null}
      <div className={card + " overflow-auto tbl-scroll"}>
        {rows.length ? (
          <table className="w-full border-collapse min-w-[1100px] text-[13px]">
            <thead><tr className="bg-subtle">{["Date", "Invoice", "Patient", "Prescriber", "Reg. no.", "Rx no.", "Medicine", "Sch.", "Batch", "Expiry", "Qty", "Billed by"].map((h) => <th key={h} className={th}>{h}</th>)}</tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className={td + " whitespace-nowrap tnum"}>{r.date}</td>
                  <td className={td + " font-mono"}><Link href={`/print/invoice/${r.saleId}`} className="text-teal no-underline">{r.invoiceNo}</Link></td>
                  <td className={td} style={{ color: r.patient ? undefined : "#B3261E" }}>{r.patient || "Missing"}</td>
                  <td className={td} style={{ color: r.prescriber ? undefined : "#B3261E" }}>{r.prescriber || "Missing"}</td>
                  <td className={td + " font-mono"} style={{ color: r.prescriberReg ? undefined : "#B3261E" }}>{r.prescriberReg || "Missing"}</td>
                  <td className={td}>{r.rxNo || "—"}</td>
                  <td className={td}>{r.medicine}</td>
                  <td className={td}>{r.schedule}</td>
                  <td className={td + " font-mono"}>{r.batchNo}</td>
                  <td className={td + " tnum"}>{r.expiry}</td>
                  <td className={td + " tnum text-right"}>{r.qty}{r.returned ? <span className="text-faint"> (−{r.returned})</span> : null}</td>
                  <td className={td}>{r.billedBy}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <div className="p-6 text-[13.5px] text-muted">No sales of Schedule H1, X or NDPS medicines at {branchName} in this period.</div>}
      </div>
      <div className="text-[12px] text-faint">Built from posted invoices, which can’t be edited. Keep the register for at least three years (Drugs Rules), and longer if your licensing authority asks.</div>
    </div>
  );
}
