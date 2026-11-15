"use client";
import { useId, useState } from "react";
import type { MockupRow, MockupTone, MockupView } from "@/data/features";

/**
 * A screen-like preview of a Medoro feature: a window with tabs and a table of sample data. Every view is in the
 * server-rendered HTML (inactive ones hidden), so search engines read all of it; the tabs only switch what's shown.
 */
const TONE: Record<NonNullable<MockupTone>, string> = {
  ok: "bg-[#E6F4EA] text-[#146C43]",
  warn: "bg-[#FFF4D6] text-[#8A5A00]",
  bad: "bg-[#FDECEA] text-[#B3261E]",
  info: "bg-[var(--s-brand-tint)] text-[var(--s-brand-ink)]",
};
const ROW: Record<NonNullable<MockupTone>, string> = { ok: "", warn: "bg-[#FFFBEF]", bad: "bg-[#FEF6F5]", info: "" };

function Row({ row, cols }: { row: MockupRow; cols: number }) {
  return (
    <tr className={`border-t border-[var(--s-line-2)] ${row.tone ? ROW[row.tone] : ""}`}>
      {row.cells.map((c, i) => (
        <td key={i} className={`px-3 py-2.5 align-top ${i === 0 ? "font-medium text-[var(--s-ink)]" : "text-[var(--s-ink-2)] whitespace-nowrap"} ${i === cols - 1 && !row.note ? "text-right" : ""}`}>
          {c}
          {i === 0 && row.note ? <span className={`ml-2 inline-block rounded-full px-2 py-0.5 text-[11.5px] font-semibold whitespace-nowrap ${TONE[row.tone ?? "info"]}`}>{row.note}</span> : null}
        </td>
      ))}
    </tr>
  );
}

export function MockupWindow({ title, views }: { title: string; views: MockupView[] }) {
  const [active, setActive] = useState(0);
  const id = useId();
  return (
    <figure className="m-0 rounded-xl overflow-hidden border border-[var(--s-line)] bg-white shadow-[0_24px_60px_-28px_rgba(14,22,20,.45)]">
      <div className="flex items-center gap-2 px-4 h-10 bg-[var(--s-soft)] border-b border-[var(--s-line)]">
        <span aria-hidden className="size-2.5 rounded-full bg-[#F28B82]" /><span aria-hidden className="size-2.5 rounded-full bg-[#F5C451]" /><span aria-hidden className="size-2.5 rounded-full bg-[#8FD3C6]" />
        <span className="ml-2 text-[13px] font-medium text-[var(--s-muted)] truncate">Medoro · {title}</span>
      </div>
      {views.length > 1 ? (
        <div role="tablist" aria-label={`${title} views`} className="flex gap-1 px-3 pt-3 overflow-x-auto">
          {views.map((v, i) => (
            <button key={v.tab} type="button" role="tab" id={`${id}-tab-${i}`} aria-selected={i === active} aria-controls={`${id}-panel-${i}`} onClick={() => setActive(i)}
              className={`h-9 px-3.5 rounded-lg text-[14px] font-semibold whitespace-nowrap transition-colors ${i === active ? "bg-[var(--s-brand)] text-white" : "text-[var(--s-ink-2)] hover:bg-[var(--s-soft)]"}`}>{v.tab}</button>
          ))}
        </div>
      ) : null}
      {views.map((v, i) => (
        <div key={v.tab} role={views.length > 1 ? "tabpanel" : undefined} id={`${id}-panel-${i}`} aria-labelledby={views.length > 1 ? `${id}-tab-${i}` : undefined} hidden={i !== active} className="p-3 flex flex-col gap-3">
          <p className="m-0 px-1 text-[13.5px] text-[var(--s-muted)]">{v.caption}</p>
          <div className="overflow-x-auto rounded-lg border border-[var(--s-line)]">
            <table className="w-full border-collapse text-[13.5px]">
              <thead className="bg-[var(--s-soft)]">
                <tr>{v.columns.map((c, ci) => <th key={c} scope="col" className={`px-3 py-2 text-left text-[12px] font-semibold uppercase tracking-[.05em] text-[var(--s-muted)] whitespace-nowrap ${ci === v.columns.length - 1 ? "text-right" : ""}`}>{c}</th>)}</tr>
              </thead>
              <tbody>{v.rows.map((r, ri) => <Row key={ri} row={r} cols={v.columns.length} />)}</tbody>
            </table>
          </div>
          {v.footer?.length ? (
            <dl className="m-0 flex flex-wrap justify-end gap-x-6 gap-y-1 px-1 text-[13.5px]">
              {v.footer.map(([k, val]) => <div key={k} className="flex gap-2"><dt className="text-[var(--s-muted)]">{k}</dt><dd className="m-0 font-semibold text-[var(--s-ink)]">{val}</dd></div>)}
            </dl>
          ) : null}
        </div>
      ))}
      <figcaption className="sr-only">Sample screen with illustrative data.</figcaption>
    </figure>
  );
}
