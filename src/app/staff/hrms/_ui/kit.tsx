"use client";
import { useRouter } from "next/navigation";
import { useCallback, useState, useTransition } from "react";
import { useToast } from "@/components/ui/toast";
import { initials } from "@/staff/hrms/constants";

export const cx = (...a: (string | false | null | undefined)[]) => a.filter(Boolean).join(" ");
export const inputCls = "border border-[#CDD2D7] rounded-lg px-3 py-2 text-[13.5px] outline-none bg-white focus:border-[#0B5E5B] w-full disabled:bg-[#F1F5F9]";
export const btnCls = "border border-[#CDD2D7] bg-white rounded-lg px-3 py-1.5 text-[12.5px] font-semibold cursor-pointer whitespace-nowrap text-[#0f172a] hover:border-[#0B5E5B] disabled:opacity-50 inline-flex items-center gap-1.5";
export const primaryCls = "bg-[#0B5E5B] text-white border-0 rounded-lg px-3.5 py-2 text-[13px] font-semibold cursor-pointer whitespace-nowrap hover:bg-[#094A48] disabled:opacity-60 inline-flex items-center gap-1.5";
export const dangerCls = "border border-[#F3C5C0] bg-white text-[#B3261E] rounded-lg px-3 py-1.5 text-[12.5px] font-semibold cursor-pointer whitespace-nowrap hover:bg-[#FDECEA] disabled:opacity-50";
export const thCls = "text-left px-3 py-2 text-[11px] font-semibold uppercase tracking-[.05em] text-[#64748B]";
export const tdCls = "px-3 py-2.5 border-t border-[#F1F5F9] text-[13px] align-middle";

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
    <section className={cx("bg-white border border-[#E2E8F0] rounded-[14px] min-w-0", className)}>
      {title ? (
        <div className="px-5 pt-4 pb-3 flex gap-3 items-center flex-wrap">
          <div className="flex flex-col"><h3 className="text-[14.5px] font-bold text-[#0f172a]">{title}</h3>{sub ? <span className="text-[12px] text-[#64748B]">{sub}</span> : null}</div>
          {right ? <div className="ml-auto flex gap-2 items-center flex-wrap">{right}</div> : null}
        </div>
      ) : null}
      <div className={pad || !title ? "px-5 pb-4 pt-1" : ""}>{children}</div>
    </section>
  );
}
export const Stat = ({ l, v, c, sub }: { l: string; v: React.ReactNode; c?: string; sub?: string }) => (
  <div className="bg-white border border-[#E2E8F0] rounded-[14px] px-4 py-3.5 min-w-0">
    <div className="text-[11px] font-semibold uppercase tracking-[.06em] text-[#64748B]">{l}</div>
    <div className="text-[22px] font-bold mt-1 truncate" style={{ color: c ?? "#0B5E5B" }}>{v}</div>
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
  return (
    <div className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center overflow-auto py-8 px-4 print:hidden" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-label={title} className={cx("bg-white rounded-2xl shadow-2xl w-full p-5 flex flex-col gap-4", wide ? "max-w-[820px]" : "max-w-[520px]")}>
        <div className="flex items-center gap-3"><h3 className="text-[16px] font-bold flex-1">{title}</h3><button onClick={onClose} aria-label="Close" className="text-[20px] leading-none text-[#64748B] cursor-pointer bg-transparent border-0">×</button></div>
        {children}
      </div>
    </div>
  );
}
export function Tabs<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex gap-0.5 bg-[#E2E8F0] p-[3px] rounded-[10px] flex-wrap self-start">
      {options.map(([v, l]) => <button key={v} type="button" onClick={() => onChange(v)} className={cx("h-[30px] px-3 rounded-lg text-[12.5px] font-semibold cursor-pointer whitespace-nowrap border-0", value === v ? "bg-[#0B5E5B] text-white" : "bg-transparent text-[#334155]")}>{l}</button>)}
    </div>
  );
}
export function Table({ head, children, empty }: { head: string[]; children: React.ReactNode; empty?: string }) {
  return (
    <div className="overflow-x-auto"><table className="w-full border-collapse"><thead><tr>{head.map((h, i) => <th key={i} className={thCls}>{h}</th>)}</tr></thead><tbody>{children}</tbody></table>
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
