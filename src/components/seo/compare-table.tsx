import { Check, HelpCircle, Minus, X } from "lucide-react";
import { CRITERIA, MEDORO, type Cell, type Comparison, type Support } from "@/data/comparisons";

/**
 * Side-by-side comparison. A real <table> for search engines and screen readers; below 720px each row becomes a card
 * with both products stacked, so nothing scrolls sideways on a phone.
 */
const ICON: Record<Support, { icon: typeof Check; label: string; cls: string }> = {
  yes: { icon: Check, label: "Yes", cls: "bg-[#E6F4EA] text-[#146C43]" },
  partial: { icon: Minus, label: "Partly", cls: "bg-[#FFF4D6] text-[#8A5A00]" },
  no: { icon: X, label: "No", cls: "bg-[#FDECEA] text-[#B3261E]" },
  ask: { icon: HelpCircle, label: "Ask the vendor", cls: "bg-[var(--s-soft)] text-[var(--s-muted)] border border-[var(--s-line)]" },
};

function CellView({ cell, who }: { cell: Cell; who: string }) {
  const s = ICON[cell.v];
  return (
    <div className="flex gap-2.5 items-start">
      <span className={`flex-none inline-flex items-center gap-1 h-6 px-2 rounded-full text-[12px] font-semibold ${s.cls}`}><s.icon size={13} aria-hidden />{s.label}</span>
      <span className="text-[14.5px] leading-[1.5] text-[var(--s-ink-2)]"><span className="sr-only">{who}: </span>{cell.note}</span>
    </div>
  );
}

export function CompareTable({ c }: { c: Comparison }) {
  return (
    <div className="rounded-xl border border-[var(--s-line)] overflow-hidden bg-white">
      <table className="w-full border-collapse text-left max-[719px]:block">
        <caption className="sr-only">Medoro compared with {c.competitor}</caption>
        <thead className="bg-[var(--s-soft)] max-[719px]:hidden">
          <tr>
            <th scope="col" className="w-[26%] px-5 py-3.5 text-[13px] font-semibold uppercase tracking-[.08em] text-[var(--s-muted)]">What matters</th>
            <th scope="col" className="w-[37%] px-5 py-3.5 text-[15px] font-semibold text-[var(--s-brand)]">Medoro</th>
            <th scope="col" className="w-[37%] px-5 py-3.5 text-[15px] font-semibold text-[var(--s-ink)]">{c.competitor}</th>
          </tr>
        </thead>
        <tbody className="max-[719px]:block">
          {CRITERIA.map(({ key, label }) => (
            <tr key={key} className="border-t border-[var(--s-line)] max-[719px]:block max-[719px]:p-4 max-[719px]:first:border-t-0">
              <th scope="row" className="px-5 py-4 align-top text-[15.5px] font-semibold text-[var(--s-ink)] max-[719px]:block max-[719px]:p-0 max-[719px]:pb-3">{label}</th>
              <td className="px-5 py-4 align-top bg-[var(--s-brand-tint)]/50 max-[719px]:block max-[719px]:rounded-lg max-[719px]:p-3 max-[719px]:mb-2">
                <span className="min-[720px]:hidden block text-[12px] font-semibold uppercase tracking-[.08em] text-[var(--s-brand)] mb-1.5">Medoro</span>
                <CellView cell={MEDORO[key]} who="Medoro" />
              </td>
              <td className="px-5 py-4 align-top max-[719px]:block max-[719px]:rounded-lg max-[719px]:p-3 max-[719px]:border max-[719px]:border-[var(--s-line)]">
                <span className="min-[720px]:hidden block text-[12px] font-semibold uppercase tracking-[.08em] text-[var(--s-muted)] mb-1.5">{c.competitor}</span>
                <CellView cell={c.them[key]} who={c.competitor} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
