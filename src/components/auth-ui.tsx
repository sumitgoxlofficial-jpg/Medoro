import { cn } from "@/components/ui/cn";

export const authInput = "w-full border border-input rounded-lg px-3 py-[11px] text-[15px] text-ink outline-none bg-white focus:border-teal focus:ring-2 focus:ring-teal/15";
export const authMono = "font-mono uppercase tracking-[.04em]";

export function AuthCard({ className, children, width = 420 }: { className?: string; children: React.ReactNode; width?: number }) {
  return <div className={cn("bg-white border border-[#E3E6E9] rounded-[14px] p-7 flex flex-col gap-3.5", className)} style={{ width: `min(${width}px, 100%)` }}>{children}</div>;
}

export function AuthLabel({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return <label className="flex flex-col gap-[5px] text-[13px] text-muted">{label}{children}</label>;
}

export function AuthButton({ className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button className={cn("bg-teal text-white rounded-[10px] py-3 text-[15px] font-semibold cursor-pointer hover:bg-teal-hover disabled:opacity-60 disabled:cursor-wait", className)} {...p} />;
}

export function AuthError({ children }: { children?: React.ReactNode }) {
  return children ? <div role="alert" className="text-[13px] text-bad">{children}</div> : null;
}

export function Steps({ labels, step }: { labels: string[]; step: number }) {
  return (
    <div className="flex gap-1.5">
      {labels.map((l, i) => (
        <div key={l} className="flex-1 flex flex-col gap-1.5">
          <div className="h-1 rounded-sm" style={{ background: step > i ? "#0B5E5B" : "#E3E6E9" }} />
          <span className="text-[11.5px]" style={{ color: step > i ? "#0B5E5B" : "#8A929A" }}>{l}</span>
        </div>
      ))}
    </div>
  );
}
