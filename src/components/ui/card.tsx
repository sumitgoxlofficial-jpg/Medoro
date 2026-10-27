import { cn } from "./cn";

export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("bg-white border border-line rounded-[10px] shadow-card", className)} {...p} />;
}

export function CardHead({ title, sub, right, className }: { title: React.ReactNode; sub?: React.ReactNode; right?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex items-center gap-3 px-4 pt-3.5 pb-2.5", className)}>
      <div className="flex flex-col min-w-0 flex-1">
        <div className="text-[14px] font-semibold text-ink-strong">{title}</div>
        {sub ? <div className="text-[12.5px] text-faint">{sub}</div> : null}
      </div>
      {right}
    </div>
  );
}

export function Empty({ icon: Icon, title, body, action, className }: { icon?: React.ComponentType<{ size?: number; className?: string }>; title: string; body?: React.ReactNode; action?: React.ReactNode; className?: string }) {
  return (
    <div className={cn("flex flex-col items-center justify-center text-center gap-2 py-10 px-6", className)}>
      {Icon ? <span className="size-10 rounded-full bg-chip flex items-center justify-center text-faint"><Icon size={20} /></span> : null}
      <div className="text-[14px] font-semibold text-ink">{title}</div>
      {body ? <div className="text-[13px] text-faint max-w-[380px]">{body}</div> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
