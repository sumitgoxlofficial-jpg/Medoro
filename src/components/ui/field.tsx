import { forwardRef } from "react";
import { cn } from "./cn";

const base = "w-full h-[38px] px-3 rounded-lg border border-input bg-white text-[14px] text-ink outline-none transition-colors placeholder:text-fainter focus:border-teal focus:ring-2 focus:ring-teal/15 disabled:bg-chip disabled:text-faint";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function Input({ className, ...p }, ref) {
  return <input ref={ref} className={cn(base, className)} {...p} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(function Textarea({ className, ...p }, ref) {
  return <textarea ref={ref} className={cn(base, "h-auto py-2 min-h-[72px]", className)} {...p} />;
});

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(function Select({ className, ...p }, ref) {
  return <select ref={ref} className={cn(base, "pr-8 cursor-pointer", className)} {...p} />;
});

export function Field({ label, hint, error, children, className }: { label: React.ReactNode; hint?: React.ReactNode; error?: string | null; children: React.ReactNode; className?: string }) {
  return (
    <label className={cn("flex flex-col gap-1.5 text-[12.5px] font-medium text-muted", className)}>
      <span>{label}</span>
      {children}
      {error ? <span className="text-[12px] text-bad font-normal">{error}</span> : hint ? <span className="text-[12px] text-faint font-normal">{hint}</span> : null}
    </label>
  );
}

export function Checkbox({ label, className, ...p }: React.InputHTMLAttributes<HTMLInputElement> & { label: React.ReactNode }) {
  return (
    <label className={cn("flex items-start gap-2 text-[13px] text-ink-2 cursor-pointer", className)}>
      <input type="checkbox" className="mt-0.5 size-4 accent-teal cursor-pointer" {...p} />
      <span>{label}</span>
    </label>
  );
}
