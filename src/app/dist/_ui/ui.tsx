// Shared presentational pieces for MEDORO Distribution, in MEDORO Pharmacy's visual language: the same cards,
// KPI tiles, badges, tables and entry/hover motion (app-up / app-card / app-tile / app-drift inside .app-motion,
// which the shell puts around every screen and switches off with reduced motion).
import Link from "next/link";
import { cn } from "@/components/ui/cn";
import { TONES, type Tone } from "@/components/ui/badge";
import { RupeeCountUp } from "./count";
import { tx } from "@/lib/tx";
import { inr } from "@/lib/money";

const vars = (d: number) => ({ ["--d" as string]: d });

export function PageHead({ title, sub, actions, back }: { title: string; sub?: React.ReactNode; actions?: React.ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="app-up flex flex-wrap items-end gap-3 mb-5" style={vars(0)}>
      <div className="flex-1 min-w-[220px]">
        {back ? <Link href={back.href} className="text-[12.5px] font-medium text-teal hover:text-teal-hover">← {tx(back.label)}</Link> : null}
        <h1 className="m-0 text-[22px] leading-tight font-semibold tracking-[-.01em] text-ink-strong">{tx(title)}</h1>
        {sub ? <div className="text-[13px] text-muted mt-1">{tx(sub)}</div> : null}
      </div>
      {actions ? <div className="flex flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function Panel({ title, sub, right, children, className, pad = true, d = 1 }: { title?: string; sub?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string; pad?: boolean; d?: number }) {
  return (
    <section className={cn("app-up app-card bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)]", className)} style={vars(d)}>
      {title ? (
        <header className="flex items-center gap-3 px-[18px] pt-4 pb-3">
          <div className="flex-1 min-w-0">
            <h2 className="m-0 text-[15px] font-semibold text-ink-strong">{tx(title)}</h2>
            {sub ? <div className="text-[12.5px] text-faint mt-0.5">{tx(sub)}</div> : null}
          </div>
          {right}
        </header>
      ) : null}
      <div className={pad ? cn("px-[18px] pb-4", !title && "pt-4") : ""}>{children}</div>
    </section>
  );
}

const STAT_TONE = {
  navy: { fg: "#0B5E5B", bg: "#E1F1EF" }, green: { fg: "#1E7F4F", bg: "#E6F4EC" }, amber: { fg: "#94570A", bg: "#FDF2E1" }, red: { fg: "#C0362C", bg: "#FDECEC" }, blue: { fg: "#2459C9", bg: "#EAF0FC" },
} as const;

/** A KPI tile like the pharmacy dashboard's: icon chip, drifting watermark icon, amounts that count up. */
export function Stat({ label, value, paise, note, tone = "navy", href, icon: Icon, d = 0 }: {
  label: string; value?: React.ReactNode; paise?: number; note?: React.ReactNode; tone?: keyof typeof STAT_TONE; href?: string; d?: number;
  icon?: React.ComponentType<{ size?: number; strokeWidth?: number; className?: string; style?: React.CSSProperties }>;
}) {
  const c = STAT_TONE[tone];
  const body = (
    <div className="app-up app-tile relative overflow-hidden bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] px-[18px] pt-4 pb-[15px] flex flex-col gap-2.5 h-full min-w-0" style={vars(d)}>
      {Icon ? <Icon aria-hidden size={64} strokeWidth={1.4} className="app-drift pointer-events-none absolute -right-2 -bottom-3 opacity-[.07]" style={{ color: c.fg, ["--dur" as string]: `${11 + (d % 3) * 2}s` }} /> : null}
      <div className="relative flex items-center gap-2">
        {Icon ? <span className="app-ico size-[26px] rounded-[7px] flex items-center justify-center flex-none" style={{ background: c.bg, color: c.fg }}><Icon size={14} /></span> : null}
        <span className="flex-1 min-w-0 text-[12.5px] text-muted font-medium leading-tight">{tx(label)}</span>
      </div>
      <div className="relative text-[24px] font-semibold tracking-[-.02em] leading-[1.1] tnum text-ink-strong">{paise !== undefined ? <RupeeCountUp paise={paise} /> : value}</div>
      {note ? <div className="relative text-[12px] text-faint line-clamp-2">{tx(note)}</div> : null}
    </div>
  );
  return href ? <Link href={href} className="block text-inherit no-underline hover:text-inherit">{body}</Link> : body;
}

export type Col = { label: string; num?: boolean; className?: string };

/** Dense, readable data table in the pharmacy screens' style. Cells are given already formatted. */
export function DataTable({ cols, rows, empty = "Nothing here yet.", dense, footer }: { cols: Col[]; rows: React.ReactNode[][]; empty?: string; dense?: boolean; footer?: React.ReactNode[] }) {
  if (!rows.length) return <div className="px-4 py-10 text-center text-[13px] text-faint">{tx(empty)}</div>;
  return (
    <div className="overflow-x-auto tbl-scroll">
      <table className="w-full border-collapse text-[13px]">
        <thead>
          <tr className="bg-subtle">
            {cols.map((c, i) => <th key={i} className={cn("text-left font-semibold text-[12px] text-muted px-3 py-2 border-y border-line whitespace-nowrap", c.num && "text-right", c.className)}>{tx(c.label)}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className="app-line hover:bg-hover border-b border-line-soft last:border-b-0 transition-colors" style={{ animationDelay: `${Math.min(i, 12) * 25}ms` }}>
              {r.map((cell, j) => <td key={j} className={cn("px-3 text-ink", dense ? "py-1.5" : "py-2.5", cols[j]?.num && "text-right tnum whitespace-nowrap", cols[j]?.className)}>{cell}</td>)}
            </tr>
          ))}
        </tbody>
        {footer ? (
          <tfoot><tr className="bg-subtle font-semibold">{footer.map((c, j) => <td key={j} className={cn("px-3 py-2 border-t border-line", cols[j]?.num && "text-right tnum")}>{c}</td>)}</tr></tfoot>
        ) : null}
      </table>
    </div>
  );
}

export const Money = ({ p, strong }: { p: number; strong?: boolean }) => <span className={cn("tnum", strong && "font-semibold", p < 0 && "text-bad")}>{inr(p)}</span>;

const TONE_ALIAS: Record<string, Tone> = { navy: "teal" };
export function Pill({ tone = "gray", children }: { tone?: string; children: React.ReactNode }) {
  const [bg, fg] = TONES[(TONE_ALIAS[tone] ?? tone) as Tone] ?? TONES.gray;
  return <span className="inline-flex items-center h-[22px] px-2 rounded-full text-[12px] font-medium whitespace-nowrap" style={{ background: bg, color: fg }}>{tx(children)}</span>;
}

export const STATUS_TONE: Record<string, string> = {
  pending: "amber", approved: "blue", picking: "blue", packed: "teal", invoiced: "teal", dispatched: "blue", delivered: "green", cancelled: "gray", rejected: "red",
  out: "blue", failed: "red", planned: "amber", closed: "green", open: "amber", raised: "amber", acknowledged: "blue", credited: "green",
  requested: "amber", suspended: "red", active: "green", hold: "amber", blocked: "red", low: "green", medium: "amber", high: "red",
};

/** Tab row like the pharmacy screens' segmented tabs. */
export function Tabs({ tabs, active }: { tabs: { href: string; label: string; key: string; count?: number }[]; active: string }) {
  return (
    <nav className="app-up inline-flex max-w-full overflow-x-auto [scrollbar-width:none] gap-px bg-white border border-line p-0.5 rounded-lg mb-4" style={vars(1)}>
      {tabs.map((t) => (
        <Link key={t.key} href={t.href} className={cn("flex-none inline-flex items-center gap-1.5 h-[30px] px-3 rounded-md text-[13px] font-medium whitespace-nowrap no-underline transition-colors",
          t.key === active ? "bg-teal text-white hover:text-white shadow-[0_1px_2px_rgba(0,0,0,.1)]" : "text-muted hover:text-ink hover:bg-chip")}>
          {tx(t.label)}{t.count ? <span className={cn("min-w-5 h-5 px-1 inline-flex items-center justify-center rounded-full text-[11px] font-semibold", t.key === active ? "bg-white/20 text-white" : "bg-teal-tint text-teal")}>{t.count}</span> : null}
        </Link>
      ))}
    </nav>
  );
}

export function Note({ tone = "gray", children }: { tone?: "gray" | "amber" | "red" | "green" | "blue"; children: React.ReactNode }) {
  const [bg, fg] = TONES[tone];
  return <div className="rounded-lg px-3.5 py-2.5 text-[13px] leading-snug" style={{ background: bg, color: fg }}>{tx(children)}</div>;
}

export const dateIN = (d: Date | string) => new Date(typeof d === "string" ? d + (d.length === 10 ? "T00:00:00+05:30" : "") : d).toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });
