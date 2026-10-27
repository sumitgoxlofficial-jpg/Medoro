"use client";
import { useEffect } from "react";
import { X } from "lucide-react";
import { cn } from "./cn";

export function Modal({ open, onClose, title, sub, children, footer, width = 480, className }: {
  open: boolean; onClose: () => void; title?: React.ReactNode; sub?: React.ReactNode;
  children: React.ReactNode; footer?: React.ReactNode; width?: number; className?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center p-5 bg-[rgba(20,28,32,.45)]" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal className={cn("bg-white rounded-[14px] shadow-modal flex flex-col max-h-[calc(100dvh-40px)]", className)} style={{ width: `min(${width}px, 100%)` }}>
        {title ? (
          <div className="flex items-start gap-3 px-6 pt-5 pb-3">
            <div className="flex-1 min-w-0">
              <div className="text-[17px] font-semibold text-ink-strong">{title}</div>
              {sub ? <div className="text-[12.5px] text-muted mt-0.5">{sub}</div> : null}
            </div>
            <button onClick={onClose} aria-label="Close" className="size-8 -mr-2 -mt-1 rounded-md flex items-center justify-center text-faint hover:bg-chip cursor-pointer"><X size={17} /></button>
          </div>
        ) : null}
        <div className="px-6 pb-5 overflow-auto flex flex-col gap-3.5">{children}</div>
        {footer ? <div className="px-6 py-3.5 border-t border-line-soft flex justify-end gap-2 flex-wrap">{footer}</div> : null}
      </div>
    </div>
  );
}
