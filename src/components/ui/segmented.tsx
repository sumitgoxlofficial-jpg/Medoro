"use client";
import { cn } from "./cn";

export function Segmented<T extends string>({ value, onChange, options, className, size = "md" }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: React.ReactNode }[]; className?: string; size?: "sm" | "md";
}) {
  return (
    <div className={cn("inline-flex max-w-full overflow-x-auto [scrollbar-width:none] gap-px bg-chip p-0.5 rounded-lg", className)}>
      {options.map((o) => {
        const a = o.value === value;
        return (
          <button key={o.value} type="button" onClick={() => onChange(o.value)}
            className={cn("flex-none rounded-md font-medium cursor-pointer whitespace-nowrap", size === "sm" ? "h-6 max-md:h-8 px-2 text-[12px]" : "h-7 max-md:h-9 px-3 text-[12.5px]",
              a ? "bg-white text-ink shadow-[0_1px_2px_rgba(0,0,0,.1)]" : "text-muted hover:text-ink")}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
