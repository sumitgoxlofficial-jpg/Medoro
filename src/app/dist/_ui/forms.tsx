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
        {msg ? <span role="status" className={cn("text-[12.5px]", msg.ok ? "text-ok" : "text-bad")}>{msg.text}</span> : null}
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
      {err ? <span role="alert" className="text-[12px] text-bad max-w-[320px]">{err}</span> : null}
    </span>
  );
}

/** Same variants and sizes as the pharmacy Button (src/components/ui/button.tsx). */
export function Btn({ variant = "outline", size = "md", className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "outline" | "danger" | "ghost"; size?: "sm" | "md" }) {
  return (
    <button type="button" {...p} className={cn(
      "relative overflow-hidden inline-flex items-center justify-center gap-1.5 font-medium whitespace-nowrap cursor-pointer transition-[background-color,border-color,box-shadow,transform] duration-200 disabled:opacity-50 disabled:cursor-not-allowed",
      size === "sm" ? "h-7 max-md:h-9 px-2.5 text-[12.5px] rounded-md" : "h-[34px] max-md:h-10 px-3 text-[13px] rounded-lg",
      variant === "primary" && "app-cta bg-teal text-white border border-teal hover:bg-teal-hover shadow-card font-semibold hover:-translate-y-px hover:shadow-[0_8px_18px_-10px_rgba(11,94,91,.8)]",
      variant === "outline" && "bg-white text-ink border border-line hover:bg-page hover:border-input shadow-card",
      variant === "danger" && "bg-white text-bad border border-[#F0C8C3] hover:bg-bad-bg",
      variant === "ghost" && "bg-transparent text-ink-2 border border-transparent hover:bg-chip",
      className)} />
  );
}

const fieldBase = "w-full h-[38px] px-3 rounded-lg border border-input bg-white text-[14px] text-ink outline-none transition-colors placeholder:text-fainter focus:border-teal focus:ring-2 focus:ring-teal/15 disabled:bg-chip disabled:text-faint";

export function F({ label, name, hint, className, ...p }: React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  const t = useT();
  const id = useId();
  return (
    <div className={cn("flex flex-col gap-1 text-[12.5px] font-medium text-muted min-w-0", className)}>
      <label htmlFor={id}>{t(label)}</label>
      <input id={id} name={name} aria-describedby={hint ? id + "-h" : undefined} {...p} className={cn(fieldBase, p.type === "checkbox" && "h-4 w-4")} />
      {hint ? <span id={id + "-h"} className="text-[12px] font-normal text-faint">{t(hint)}</span> : null}
    </div>
  );
}

export function S({ label, name, options, className, ...p }: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; options: { value: string; label: string }[] }) {
  const t = useT();
  const id = useId();
  return (
    <div className={cn("flex flex-col gap-1 text-[12.5px] font-medium text-muted min-w-0", className)}>
      <label htmlFor={id}>{t(label)}</label>
      <select id={id} name={name} {...p} className={cn(fieldBase, "pr-7 cursor-pointer")}>{options.map((o) => <option key={o.value} value={o.value}>{t(o.label)}</option>)}</select>
    </div>
  );
}

export function Check({ label, name, defaultChecked }: { label: string; name: string; defaultChecked?: boolean }) {
  const t = useT();
  return <label className="flex items-center gap-2 text-[13px] text-ink-2 cursor-pointer"><input type="checkbox" name={name} defaultChecked={defaultChecked} className="size-4 accent-teal cursor-pointer" />{t(label)}</label>;
}

/** Collapsible "add / edit" panel for master screens. */
export function Drawer({ label, children, open }: { label: string; children: React.ReactNode; open?: boolean }) {
  const t = useT();
  return (
    <details open={open} className="app-up app-card group bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] mb-4" style={{ ["--d" as string]: 1 }}>
      <summary className="cursor-pointer list-none px-[18px] py-3.5 text-[14px] font-semibold text-ink-strong flex items-center gap-2.5 select-none">
        <span className="app-ico inline-flex size-[26px] items-center justify-center rounded-[7px] bg-teal-tint text-teal text-[16px] group-open:rotate-45 transition-transform">+</span>{t(label)}
      </summary>
      <div className="px-[18px] pb-4 pt-3 border-t border-line-soft">{children}</div>
    </details>
  );
}

export const Grid = ({ children, cols = 3 }: { children: React.ReactNode; cols?: 2 | 3 | 4 | 6 }) => (
  <div className={cn("grid gap-3 grid-cols-1", cols === 2 && "sm:grid-cols-2", cols === 3 && "sm:grid-cols-2 lg:grid-cols-3", cols === 4 && "sm:grid-cols-2 lg:grid-cols-4", cols === 6 && "sm:grid-cols-3 lg:grid-cols-6")}>{children}</div>
);
