"use client";
import { useRouter } from "next/navigation";
import { useCallback, useTransition } from "react";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/components/ui/cn";

export const panel = "bg-white border border-[#E6E8EB] rounded-xl";
export const th = "text-left px-4 py-2.5 font-medium";
export const td = "px-4 py-2.5 border-t border-[#F1F3F4]";
export const fieldCls = "border border-input rounded-lg px-[11px] py-[9px] text-[14px] outline-none bg-white focus:border-teal w-full";
export const selSm = "border border-input rounded-lg px-2 py-1.5 text-[13px] outline-none bg-white focus:border-teal";
export const lbl = "flex flex-col gap-[5px] text-[12.5px] text-muted";
export const btn = "border border-input bg-white rounded-[7px] px-2.5 py-1.5 text-[12.5px] font-semibold cursor-pointer whitespace-nowrap text-ink flex gap-[5px] items-center hover:border-teal disabled:opacity-50";
export const btnPrimary = "bg-teal text-white border-0 rounded-lg px-3.5 py-[9px] text-[13.5px] font-semibold cursor-pointer whitespace-nowrap flex gap-1.5 items-center hover:bg-teal-hover disabled:opacity-60";

export function Panel({ title, sub, right, children, className }: { title?: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn(panel, "overflow-hidden min-w-0", className)}>
      {title ? (
        <div className="px-4 py-3.5 border-b border-[#EEF0F2] flex gap-2.5 items-center flex-wrap">
          <div className="flex flex-col"><strong className="text-[14.5px]">{title}</strong>{sub ? <span className="text-[12.5px] text-muted">{sub}</span> : null}</div>
          {right ? <div className="ml-auto flex gap-2 items-center flex-wrap">{right}</div> : null}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Kpi({ l, v, d, c }: { l: string; v: string; d?: string; c?: string }) {
  return (
    <div className={cn(panel, "px-[18px] py-4 flex flex-col gap-1 min-w-0")}>
      <span className="text-[12.5px] text-muted">{l}</span>
      <span className="text-[24px] font-bold tracking-[-.02em] tnum truncate" style={{ color: c }}>{v}</span>
      {d ? <span className="text-[12px] text-muted">{d}</span> : null}
    </div>
  );
}

export function Pill({ bg, fg, children }: { bg: string; fg: string; children: React.ReactNode }) {
  return <span className="px-[9px] py-0.5 rounded-full text-[12px] font-semibold whitespace-nowrap" style={{ background: bg, color: fg }}>{children}</span>;
}

export function Tabs<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="inline-flex gap-0.5 bg-[#EEF0F2] p-[3px] rounded-lg flex-wrap self-start">
      {options.map(([v, l]) => (
        <button key={v} type="button" onClick={() => onChange(v)} className={cn("h-[30px] px-2.5 rounded-md text-[12.5px] font-semibold cursor-pointer whitespace-nowrap", value === v ? "bg-white shadow-[0_1px_2px_rgba(0,0,0,.1)]" : "")}>{l}</button>
      ))}
    </div>
  );
}

export const Empty = ({ children }: { children: React.ReactNode }) => <div className="px-4 py-6 text-center text-muted text-[14px]">{children}</div>;

/** Runs a server action, shows its message or error, and refreshes server data on success. */
export function useRun() {
  const toast = useToast();
  const router = useRouter();
  const [busy, start] = useTransition();
  const run = useCallback(<T,>(fn: () => Promise<{ ok: true; data: T; message?: string } | { ok: false; error: string }>, onOk?: (d: T) => void | string) => {
    start(async () => {
      const r = await fn();
      if (!r.ok) { toast(r.error, "red"); return; }
      const m = onOk?.(r.data);
      if (typeof m === "string") toast(m, "green"); else if (r.message) toast(r.message, "green");
      router.refresh();
    });
  }, [toast, router]);
  return { run, busy };
}

export const fmtDay = (iso: string) => new Date(iso.length === 10 ? iso + "T00:00:00" : iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" });
export const fmtTime = (iso: string) => new Date(iso).toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
