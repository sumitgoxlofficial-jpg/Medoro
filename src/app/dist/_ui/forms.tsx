"use client";
import { useId, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/components/ui/cn";
import { useT } from "@/lib/i18n-client";

type Result = { ok: true; data?: unknown; message?: string } | { ok: false; error: string };

const fillUrl = (tpl: string | undefined, data: unknown) =>
  tpl ? tpl.replace(/\{(\w+)\}/g, (_, k: string) => encodeURIComponent(String((data as Record<string, unknown> | null)?.[k] ?? ""))) : null;

/** A form posted to a server action, with inline success / error and a page refresh. */
export function ActForm({ action, children, submit = "Save", className, resetOnOk = false, confirm, redirectTo, variant = "primary", inline }: {
  action: (fd: FormData) => Promise<Result>; children?: React.ReactNode; submit?: string; className?: string; resetOnOk?: boolean; confirm?: string;
  /** Where to go on success; "{key}" is replaced with that field of the action's result (e.g. "/dist/invoices/{invoiceId}"). */
  redirectTo?: string; variant?: "primary" | "outline" | "danger"; inline?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const ref = useRef<HTMLFormElement>(null);
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <form ref={ref} className={cn(inline ? "flex flex-wrap items-end gap-2" : "flex flex-col gap-3", className)}
      onSubmit={(e) => {
        e.preventDefault();
        if (confirm && !window.confirm(t(confirm))) return;
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const r = await action(fd);
          if (r.ok) {
            setMsg(r.message ? { ok: true, text: t(r.message) } : null);
            if (resetOnOk) ref.current?.reset();
            const to = fillUrl(redirectTo, r.data);
            if (to) router.push(to); else router.refresh();
          } else setMsg({ ok: false, text: t(r.error) });
        });
      }}>
      {children}
      <div className="flex items-center gap-3 flex-wrap">
        <Btn type="submit" disabled={pending} variant={variant}>{pending ? t("Working…") : t(submit)}</Btn>
        {msg ? <span role="status" className={cn("text-[12.5px]", msg.ok ? "text-[#1E7F4F]" : "text-[#B3261E]")}>{msg.text}</span> : null}
      </div>
    </form>
  );
}

/** One-click action (optionally asking for a reason) with inline feedback. */
export function ActButton({ action, label, ask, confirm, variant = "outline", size = "md", redirectTo }: {
  action: (reason: string) => Promise<Result>; label: string; ask?: string; confirm?: string; variant?: "primary" | "outline" | "danger"; size?: "sm" | "md"; redirectTo?: string;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  return (
    <span className="inline-flex flex-col gap-1">
      <Btn variant={variant} size={size} disabled={pending} onClick={() => {
        let reason = "";
        if (ask) { const r = window.prompt(t(ask)); if (r === null) return; reason = r; }
        if (confirm && !window.confirm(t(confirm))) return;
        start(async () => {
          const r = await action(reason);
          if (r.ok) { setErr(null); const to = fillUrl(redirectTo, r.data); if (to) router.push(to); else router.refresh(); } else setErr(t(r.error));
        });
      }}>{pending ? t("Working…") : t(label)}</Btn>
      {err ? <span role="alert" className="text-[12px] text-[#B3261E] max-w-[320px]">{err}</span> : null}
    </span>
  );
}

export function Btn({ variant = "outline", size = "md", className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "outline" | "danger" | "ghost"; size?: "sm" | "md" }) {
  return (
    <button type="button" {...p} className={cn(
      "inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold whitespace-nowrap cursor-pointer transition-colors disabled:opacity-50 disabled:cursor-not-allowed",
      size === "sm" ? "h-8 px-2.5 text-[12.5px]" : "h-[36px] max-md:h-11 px-3.5 text-[13px]",
      variant === "primary" && "bg-[#0B2545] text-white border border-[#0B2545] hover:bg-[#13315C]",
      variant === "outline" && "bg-white text-[#0B2545] border border-[#C9D2DE] hover:bg-[#F3F6F9]",
      variant === "danger" && "bg-white text-[#B3261E] border border-[#F0C8C3] hover:bg-[#FBEAE8]",
      variant === "ghost" && "bg-transparent text-[#0B2545] border border-transparent hover:bg-[#EEF2F6]",
      className)} />
  );
}

const fieldBase = "w-full h-[36px] max-md:h-11 px-2.5 rounded-md border border-[#C9D2DE] bg-white text-[13.5px] text-[#0B2545] outline-none focus:border-[#0B2545] focus:ring-2 focus:ring-[#0B2545]/10";

export function F({ label, name, hint, className, ...p }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const t = useT();
  const id = useId();
  return (
    <div className={cn("flex flex-col gap-1 text-[12px] font-medium text-[#4A5A73] min-w-0", className)}>
      <label htmlFor={id}>{t(label)}</label>
      <input id={id} name={name} aria-describedby={hint ? id + "-h" : undefined} {...p} className={cn(fieldBase, p.type === "checkbox" && "h-4 w-4")} />
      {hint ? <span id={id + "-h"} className="text-[11.5px] font-normal text-[#6B7A90]">{t(hint)}</span> : null}
    </div>
  );
}

export function S({ label, name, options, className, ...p }: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; options: { value: string; label: string }[] }) {
  const t = useT();
  const id = useId();
  return (
    <div className={cn("flex flex-col gap-1 text-[12px] font-medium text-[#4A5A73] min-w-0", className)}>
      <label htmlFor={id}>{t(label)}</label>
      <select id={id} name={name} {...p} className={cn(fieldBase, "pr-7 cursor-pointer")}>{options.map((o) => <option key={o.value} value={o.value}>{t(o.label)}</option>)}</select>
    </div>
  );
}

export function Check({ label, name, defaultChecked }: { label: string; name: string; defaultChecked?: boolean }) {
  const t = useT();
  return <label className="flex items-center gap-2 text-[13px] text-[#1B2B44] cursor-pointer"><input type="checkbox" name={name} defaultChecked={defaultChecked} className="size-4 accent-[#0B2545]" />{t(label)}</label>;
}

/** Collapsible "add / edit" panel for master screens. */
export function Drawer({ label, children, open }: { label: string; children: React.ReactNode; open?: boolean }) {
  const t = useT();
  return (
    <details open={open} className="group bg-white border border-[#E3E7ED] rounded-[10px] mb-4">
      <summary className="cursor-pointer list-none px-4 py-3 text-[13.5px] font-semibold text-[#0B2545] flex items-center gap-2 select-none">
        <span className="inline-flex size-5 items-center justify-center rounded bg-[#E8EDF5] text-[#0B2545] group-open:rotate-45 transition-transform">+</span>{t(label)}
      </summary>
      <div className="px-4 pb-4 pt-1 border-t border-[#EEF1F5]">{children}</div>
    </details>
  );
}

export const Grid = ({ children, cols = 3 }: { children: React.ReactNode; cols?: 2 | 3 | 4 | 6 }) => (
  <div className={cn("grid gap-3 grid-cols-1", cols === 2 && "sm:grid-cols-2", cols === 3 && "sm:grid-cols-2 lg:grid-cols-3", cols === 4 && "sm:grid-cols-2 lg:grid-cols-4", cols === 6 && "sm:grid-cols-3 lg:grid-cols-6")}>{children}</div>
);
