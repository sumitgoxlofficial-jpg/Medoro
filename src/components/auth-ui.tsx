import { cn } from "@/components/ui/cn";
import { T } from "@/lib/i18n-client";

// Plain-text labels, button text and errors are shown in the chosen language (<T> looks up the Hindi line).

export const authInput = "w-full border border-input rounded-lg px-3 py-[11px] text-[15px] text-ink outline-none bg-white focus:border-teal focus:ring-2 focus:ring-teal/15";
export const authMono = "font-mono uppercase tracking-[.04em]";

export function AuthCard({ className, children, width = 420 }: { className?: string; children: React.ReactNode; width?: number }) {
  return <div className={cn("hr-glow relative bg-white/90 backdrop-blur-md border border-[#E3E6E9] rounded-2xl p-7 flex flex-col gap-3.5 shadow-[0_24px_60px_-30px_rgba(11,94,91,.4)]", className)} style={{ width: `min(${width}px, 100%)` }}>{children}</div>;
}

export function AuthLabel({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return <label className="flex flex-col gap-[5px] text-[13px] text-muted">{typeof label === "string" ? <T>{label}</T> : label}{children}</label>;
}

export function AuthButton({ className, children, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={cn("hr-btn relative overflow-hidden bg-teal text-white rounded-[10px] py-3 text-[15px] font-semibold cursor-pointer transition-[background-color,transform,box-shadow] duration-300 hover:bg-teal-hover hover:-translate-y-0.5 hover:shadow-[0_12px_24px_-12px_rgba(11,94,91,.7)] disabled:opacity-60 disabled:cursor-wait disabled:translate-y-0", className)} {...p}>{typeof children === "string" ? <T>{children}</T> : children}</button>;
}

export function AuthError({ children }: { children?: React.ReactNode }) {
  return children ? <div role="alert" className="text-[13px] text-bad">{typeof children === "string" ? <T>{children}</T> : children}</div> : null;
}

export function Steps({ labels, step }: { labels: string[]; step: number }) {
  return (
    <div className="flex gap-1.5">
      {labels.map((l, i) => (
        <div key={l} className="flex-1 flex flex-col gap-1.5">
          <div className="h-1 rounded-sm" style={{ background: step > i ? "#0B5E5B" : "#E3E6E9" }} />
          <span className="text-[11.5px]" style={{ color: step > i ? "#0B5E5B" : "#8A929A" }}><T>{l}</T></span>
        </div>
      ))}
    </div>
  );
}
