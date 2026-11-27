"use client";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { createPortal } from "react-dom";
import { useToast } from "@/components/ui/toast";
import { initials } from "@/staff/hrms/constants";
import { CountUp } from "@/components/welcome-banner";
import { useBrowserValue } from "@/lib/react-state";

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");
export const inputCls = "border border-[#CBD5E1] rounded-lg px-3 py-2 text-[13.5px] outline-none bg-white transition-[border-color,box-shadow] hover:border-[#94A3B8] focus:border-[#0B5E5B] focus:shadow-[0_0_0_3px_rgba(20,184,166,.18)] w-full disabled:bg-[#F1F5F9]";
export const btnCls = "border border-[#CBD5E1] bg-white rounded-lg px-3 py-1.5 text-[12.5px] font-semibold cursor-pointer whitespace-nowrap text-[#0f172a] shadow-[0_1px_1px_rgba(15,23,42,.04)] transition-colors hover:border-[#0B5E5B] hover:bg-[#F8FAFC] disabled:opacity-50 inline-flex items-center gap-1.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B5E5B]";
export const primaryCls = "bg-[#0B5E5B] text-white border-0 rounded-lg px-3.5 py-2 text-[13px] font-semibold cursor-pointer whitespace-nowrap shadow-[0_1px_2px_rgba(11,94,91,.3)] transition-colors hover:bg-[#094A48] active:bg-[#073D3B] disabled:opacity-60 inline-flex items-center gap-1.5 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B5E5B]";
export const dangerCls = "border border-[#F3C5C0] bg-white text-[#B3261E] rounded-lg px-3 py-1.5 text-[12.5px] font-semibold cursor-pointer whitespace-nowrap transition-colors hover:bg-[#FDECEA] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#B3261E]";
export const thCls = "text-left px-3 py-2.5 text-[11px] font-semibold uppercase tracking-[.06em] text-[#64748B] bg-[#F8FAFC] border-y border-[#EEF2F6] first:pl-5 last:pr-5 whitespace-nowrap";
export const tdCls = "px-3 py-3 border-t border-[#F1F5F9] text-[13px] align-middle first:pl-5 last:pr-5";

/** Runs a server action, toasts its message or error, and refreshes the page data on success. */
export function useRun() {
  const toast = useToast(), router = useRouter();
  const [busy, start] = useTransition();
  const run = useCallback(<T,>(fn: () => Promise<{ ok: true; data: T; message?: string } | { ok: false; error: string }>, onOk?: (d: T) => void | string) => {
    start(async () => {
      const r = await fn();
      if (!r.ok) { toast(r.error, "red"); return; }
      const m = onOk?.(r.data);
      const text = typeof m === "string" ? m : r.message;
      if (text) toast(text, "green");
      router.refresh();
    });
  }, [toast, router]);
  return { run, busy, toast };
}

export function Card({ title, sub, right, children, className, pad = false }: { title?: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cx("hr-sect bg-white border border-[#DCE3EA] rounded-xl shadow-[0_1px_2px_rgba(15,23,42,.05),0_1px_3px_rgba(15,23,42,.04)] min-w-0", className)}>
      {title ? (
        <div className="px-5 pt-4 pb-3 flex gap-3 items-center flex-wrap">
          <div className="flex flex-col"><h3 className="text-[14.5px] font-semibold tracking-[-.005em] text-[#0f172a]">{title}</h3>{sub ? <span className="text-[12px] text-[#64748B]">{sub}</span> : null}</div>
          {right ? <div className="ml-auto flex gap-2 items-center flex-wrap">{right}</div> : null}
        </div>
      ) : null}
      <div className={pad || !title ? "px-5 pb-4 pt-1" : ""}>{children}</div>
    </section>
  );
}
export const Stat = ({ l, v, c, sub }: { l: string; v: React.ReactNode; c?: string; sub?: string }) => (
  <div className="hr-stat relative overflow-hidden bg-white border border-[#DCE3EA] rounded-xl shadow-[0_1px_2px_rgba(15,23,42,.05),0_1px_3px_rgba(15,23,42,.04)] px-4 py-3.5 min-w-0">
    <div className="text-[11px] font-semibold uppercase tracking-[.06em] text-[#64748B]">{l}</div>
    <div className="text-[22px] font-bold mt-1 truncate" style={{ color: c ?? "#0B5E5B" }}>{typeof v === "number" ? <CountUp value={v} format={String} /> : v}</div>
    {sub ? <div className="text-[11.5px] text-[#64748B] mt-0.5">{sub}</div> : null}
  </div>
);
export const Grid = ({ n = 4, children, className }: { n?: number; children: React.ReactNode; className?: string }) => (
  <div className={cx("grid gap-3.5", className)} style={{ gridTemplateColumns: `repeat(auto-fit,minmax(${n >= 4 ? 190 : n === 3 ? 260 : 340}px,1fr))` }}>{children}</div>
);
export const Empty = ({ children }: { children: React.ReactNode }) => <div className="py-6 text-center text-[13.5px] text-[#64748B]">{children}</div>;
export const Field = ({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) => (
  <label className="flex flex-col gap-1 text-[12px] font-semibold text-[#475569] min-w-0">{label}{children}{hint ? <span className="font-normal text-[11.5px] text-[#64748B]">{hint}</span> : null}</label>
);

const TONES: Record<string, [string, string]> = {
  green: ["#D6F3EF", "#0B5E5B"], amber: ["#FEF3C7", "#B45309"], red: ["#FEE2E2", "#DC2626"], blue: ["#DBEAFE", "#1E40AF"], gray: ["#F1F5F9", "#475569"], purple: ["#EDE9FE", "#5B45B0"],
};
export const Pill = ({ tone = "gray", children }: { tone?: keyof typeof TONES; children: React.ReactNode }) => (
  <span className="text-[10.5px] font-semibold px-2.5 py-[3px] rounded-full whitespace-nowrap inline-block" style={{ background: TONES[tone][0], color: TONES[tone][1] }}>{children}</span>
);
export const statusTone = (s: string): keyof typeof TONES =>
  /approved|paid|active|present|won|done|resolved|hired|fulfilled|accepted|reconciled|applied/i.test(s) ? "green" : /pending|late|draft|due|open|processing|waiting|new|planning|sent|low/i.test(s) ? "amber" : /reject|overdue|absent|lost|cancel|closed|out of|deactiv/i.test(s) ? "red" : "gray";

export function Avatar({ name, photo, size = 34, dot }: { name: string; photo?: string | null; size?: number; dot?: string }) {
  return (
    <span className="relative inline-flex flex-none" style={{ width: size, height: size }}>
      {photo
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={photo} alt="" className="rounded-full object-cover" style={{ width: size, height: size }} />
        : <span className="rounded-full bg-[#D6F3EF] text-[#0B5E5B] font-bold flex items-center justify-center" style={{ width: size, height: size, fontSize: size * 0.36 }}>{initials(name)}</span>}
      {dot ? <span className="absolute right-0 bottom-0 rounded-full border-2 border-white" style={{ width: size * 0.3, height: size * 0.3, background: dot }} /> : null}
    </span>
  );
}
export const presenceColor = (p: string) => (p === "active" ? "#14B8A6" : p === "break" ? "#F59E0B" : "#94A3B8");

export function Modal({ title, onClose, children, wide }: { title: string; onClose: () => void; children: React.ReactNode; wide?: boolean }) {
  // Rendered on <body> so a parent card's transform, filter or overflow can't trap the window inside the card.
  const host = useBrowserValue<HTMLElement | null>(() => document.body, null);
  if (!host) return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] bg-[#0f172a]/45 backdrop-blur-[2px] flex items-start justify-center overflow-auto py-8 px-4 text-[#0f172a]" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={title} className={cx("cp-in bg-white rounded-2xl border border-[#E2E8F0] shadow-[0_24px_60px_-20px_rgba(15,23,42,.45)] w-full p-5 flex flex-col gap-4", wide ? "max-w-[820px]" : "max-w-[520px]")}>
        <div className="flex items-center gap-3 -mx-5 -mt-1 px-5 pb-3 border-b border-[#EEF2F6]"><h3 className="text-[16px] font-semibold flex-1">{title}</h3><button onClick={onClose} aria-label="Close" className="size-8 rounded-lg flex items-center justify-center text-[#64748B] cursor-pointer bg-transparent border-0 hover:bg-[#F1F5F9] hover:text-[#0f172a]"><svg viewBox="0 0 24 24" className="size-[18px]" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M18 6 6 18M6 6l12 12" /></svg></button></div>
        {children}
      </div>
    </div>,
    host,
  );
}
export function Tabs<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div role="group" className="inline-flex gap-0.5 bg-[#EEF2F6] border border-[#E2E8F0] p-[3px] rounded-[10px] flex-wrap self-start">
      {options.map(([v, l]) => <button key={v} type="button" aria-pressed={value === v} onClick={() => onChange(v)} className={cx("h-[30px] px-3 rounded-[7px] text-[12.5px] font-semibold cursor-pointer whitespace-nowrap border-0 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0B5E5B]", value === v ? "bg-white text-[#0B5E5B] shadow-[0_1px_2px_rgba(15,23,42,.12)]" : "bg-transparent text-[#475569] hover:text-[#0f172a]")}>{l}</button>)}
    </div>
  );
}
export function Table({ head, children, empty }: { head: string[]; children: React.ReactNode; empty?: string }) {
  return (
    <div className="overflow-x-auto"><table className="w-full min-w-[640px] border-collapse"><thead><tr>{head.map((h, i) => <th key={i} scope="col" className={thCls}>{h}</th>)}</tr></thead><tbody className="[&>tr]:transition-colors [&>tr:hover]:bg-[#F8FAFC]">{children}</tbody></table>
      {empty ? <Empty>{empty}</Empty> : null}</div>
  );
}
export const dayLabel = (iso: string) => new Date(iso.slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-IN", { day: "numeric", month: "short", timeZone: "UTC" });
export const dayLong = (iso: string) => new Date(iso.slice(0, 10) + "T00:00:00Z").toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
export const timeLabel = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Asia/Kolkata" });
export const ago = (iso: string) => { const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000); return m < 1 ? "now" : m < 60 ? `${m}m ago` : m < 1440 ? `${Math.round(m / 60)}h ago` : `${Math.round(m / 1440)}d ago`; };

export function download(name: string, text: string, type = "text/csv") {
  const url = URL.createObjectURL(new Blob([text], { type: type + ";charset=utf-8" }));
  const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); URL.revokeObjectURL(url);
}
export function useForm<T extends Record<string, unknown>>(init: T) {
  const [v, setV] = useState(init);
  const set = <K extends keyof T>(k: K, val: T[K]) => setV((p) => ({ ...p, [k]: val }));
  return [v, set, setV] as const;
}
export const money = (n: number) => "₹" + Math.round(n).toLocaleString("en-IN");
export const Hide = ({ n, show }: { n: number; show: boolean }) => <>{show ? money(n) : "₹ ••••••"}</>;

/** Menu-item style for buttons inside a MoreMenu. */
export const menuItemCls = "block w-full text-left px-3 py-2 rounded-lg text-[13px] text-[#0f172a] hover:bg-[#F1F5F9] cursor-pointer bg-transparent border-0 whitespace-nowrap";
export const menuDangerCls = "block w-full text-left px-3 py-2 rounded-lg text-[13px] text-[#B3261E] hover:bg-[#FDECEA] cursor-pointer bg-transparent border-0 whitespace-nowrap";
/**
 * A "More" button that opens a small menu of secondary actions (the row-actions menu of enterprise tables). The menu
 * closes on a click outside, on Escape, and after an item is chosen. Items are ordinary buttons (menuItemCls).
 */
export function MoreMenu({ children, label = "More" }: { children: React.ReactNode; label?: string }) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away); document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  return (
    <div ref={box} className="relative inline-block">
      <button type="button" className={btnCls} aria-expanded={open} aria-haspopup="true" onClick={() => setOpen((o) => !o)}>
        {label}<svg viewBox="0 0 24 24" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="m6 9 6 6 6-6" /></svg>
      </button>
      {open ? <div className="cp-in absolute right-0 top-full mt-1.5 z-30 min-w-[190px] bg-white border border-[#E2E8F0] rounded-xl shadow-[0_16px_40px_-16px_rgba(15,23,42,.35)] p-1.5" onClick={(e) => { if ((e.target as HTMLElement).closest("button")) setOpen(false); }}>{children}</div> : null}
    </div>
  );
}
