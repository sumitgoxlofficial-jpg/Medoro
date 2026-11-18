// Shared presentational pieces for MEDORO Distribution (server-safe: no hooks).
import Link from "next/link";
import { cn } from "@/components/ui/cn";
import { tx } from "@/lib/tx";
import { inr } from "@/lib/money";

export function PageHead({ title, sub, actions, back }: { title: string; sub?: React.ReactNode; actions?: React.ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="flex flex-wrap items-end gap-3 mb-5">
      <div className="flex-1 min-w-[220px]">
        {back ? <Link href={back.href} className="text-[12.5px] text-[#4A5A73] hover:text-[#0B2545]">← {tx(back.label)}</Link> : null}
        <h1 className="m-0 text-[22px] leading-tight font-semibold tracking-[-0.01em] text-[#0B2545]">{tx(title)}</h1>
        {sub ? <div className="text-[13px] text-[#5B6B82] mt-1">{tx(sub)}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Panel({ title, sub, right, children, className, pad = true }: { title?: string; sub?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cn("bg-white border border-[#E3E7ED] rounded-[10px]", className)}>
      {title ? (
        <header className="flex items-center gap-3 px-4 py-3 border-b border-[#EEF1F5]">
          <div className="flex-1 min-w-0">
            <h2 className="m-0 text-[13.5px] font-semibold text-[#0B2545] uppercase tracking-[0.04em]">{tx(title)}</h2>
            {sub ? <div className="text-[12.5px] text-[#5B6B82]">{tx(sub)}</div> : null}
          </div>
          {right}
        </header>
      ) : null}
      <div className={pad ? "p-4" : ""}>{children}</div>
    </section>
  );
}

export function Stat({ label, value, note, tone = "navy", href }: { label: string; value: React.ReactNode; note?: React.ReactNode; tone?: "navy" | "green" | "amber" | "red"; href?: string }) {
  const color = { navy: "#0B2545", green: "#1E7F4F", amber: "#94570A", red: "#B3261E" }[tone];
  const body = (
    <div className="bg-white border border-[#E3E7ED] rounded-[10px] px-4 py-3.5 h-full hover:border-[#C9D2DE] transition-colors">
      <div className="text-[11.5px] font-semibold uppercase tracking-[0.06em] text-[#5B6B82]">{tx(label)}</div>
      <div className="mt-1 text-[22px] font-semibold tnum" style={{ color }}>{value}</div>
      {note ? <div className="text-[12px] text-[#5B6B82] mt-0.5">{tx(note)}</div> : null}
    </div>
  );
  return href ? <Link href={href} className="block text-inherit hover:text-inherit">{body}</Link> : body;
}

export type Col = { label: string; num?: boolean; className?: string };

/** Dense, readable data table. Cells are given already formatted. */
export function DataTable({ cols, rows, empty = "Nothing here yet.", dense, footer }: { cols: Col[]; rows: React.ReactNode[][]; empty?: string; dense?: boolean; footer?: React.ReactNode[] }) {
  if (!rows.length) return <div className="px-4 py-10 text-center text-[13px] text-[#5B6B82]">{tx(empty)}</div>;
  return (
    <div className="overflow-x-auto tbl-scroll">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="bg-[#F6F8FA]">
            {cols.map((c, i) => <th key={i} className={cn("text-left font-semibold text-[11.5px] uppercase tracking-[0.04em] text-[#4A5A73] px-3 py-2 border-b border-[#E3E7ED] whitespace-nowrap", c.num && "text-right", c.className)}>{tx(c.label)}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="hover:bg-[#FAFBFC] border-b border-[#EEF1F5] last:border-b-0">
              {r.map((cell, j) => <td key={j} className={cn("px-3 text-[#1B2B44]", dense ? "py-1.5" : "py-2.5", cols[j]?.num && "text-right tnum whitespace-nowrap", cols[j]?.className)}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
        {footer ? (
          <tfoot><tr className="bg-[#F6F8FA] font-semibold">{footer.map((c, j) => <td key={j} className={cn("px-3 py-2 border-t border-[#E3E7ED]", cols[j]?.num && "text-right tnum")}>{c}</td>)}</tr></tfoot>
        ) : null}
      </table>
    </div>
  );
}

export const Money = ({ p, strong }: { p: number; strong?: boolean }) => <span className={cn("tnum", strong && "font-semibold", p < 0 && "text-[#B3261E]")}>{inr(p)}</span>;

const TONE: Record<string, [string, string]> = {
  green: ["#E6F4EC", "#1E7F4F"], amber: ["#FDF2E1", "#94570A"], red: ["#FBEAE8", "#B3261E"], blue: ["#EAF0FC", "#2459C9"], gray: ["#EEF0F2", "#4B535B"], navy: ["#E8EDF5", "#0B2545"],
};
export function Pill({ tone = "gray", children }: { tone?: keyof typeof TONE | string; children: React.ReactNode }) {
  const [bg, fg] = TONE[tone] ?? TONE.gray;
  return <span className="inline-flex items-center h-[21px] px-2 rounded-full text-[11.5px] font-semibold whitespace-nowrap" style={{ background: bg, color: fg }}>{tx(children)}</span>;
}

export const STATUS_TONE: Record<string, string> = {
  pending: "amber", approved: "blue", picking: "blue", packed: "navy", invoiced: "navy", dispatched: "blue", delivered: "green", cancelled: "gray", rejected: "red",
  out: "blue", failed: "red", planned: "amber", closed: "green", open: "amber", raised: "amber", acknowledged: "blue", credited: "green",
  requested: "amber", suspended: "red", active: "green", hold: "amber", blocked: "red", low: "green", medium: "amber", high: "red",
};

export function Tabs({ tabs, active }: { tabs: { href: string; label: string; key: string; count?: number }[]; active: string }) {
  return (
    <nav className="flex gap-1 border-b border-[#E3E7ED] mb-4 overflow-x-auto [scrollbar-width:none]">
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} className={cn("px-3 py-2 text-[13px] font-medium whitespace-nowrap border-b-2 -mb-px", t.key === active ? "border-[#0B2545] text-[#0B2545]" : "border-transparent text-[#5B6B82] hover:text-[#0B2545]")}>
          {tx(t.label)}{t.count ? <span className="ml-1.5 inline-flex min-w-5 h-5 px-1 items-center justify-center rounded-full bg-[#E8EDF5] text-[11px] text-[#0B2545]">{t.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

export function Note({ tone = "gray", children }: { tone?: "gray" | "amber" | "red" | "green" | "blue"; children: React.ReactNode }) {
  const [bg, fg] = TONE[tone];
  return <div className="rounded-lg px-3.5 py-2.5 text-[13px] leading-snug" style={{ background: bg, color: fg }}>{tx(children)}</div>;
}

export const dateIN = (d: Date | string) => new Date(typeof d === "string" ? d + (d.length === 10 ? "T00:00:00+05:30" : "") : d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
