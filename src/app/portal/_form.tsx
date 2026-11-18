"use client";
import { useId, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n-client";

type R = { ok: true; message?: string } | { ok: false; error: string };
export function PForm({ action, submit, children, reset }: { action: (fd: FormData) => Promise<R>; submit: string; children: React.ReactNode; reset?: boolean }) {
  const t = useT();
  const router = useRouter();
  const [p, start] = useTransition();
  const [m, setM] = useState<{ ok: boolean; text: string } | null>(null);
  return (
    <form className="flex flex-col gap-3" onSubmit={(e) => { e.preventDefault(); const f = e.currentTarget, fd = new FormData(f); start(async () => { const r = await action(fd); if (r && !r.ok) setM({ ok: false, text: t(r.error) }); else { setM(r?.message ? { ok: true, text: t(r.message) } : null); if (reset) f.reset(); router.refresh(); } }); }}>
      {children}
      <button disabled={p} className="h-11 rounded-lg bg-teal text-white font-semibold disabled:opacity-50">{p ? t("Working…") : t(submit)}</button>
      {m ? <div role="status" className={`text-[13px] ${m.ok ? "text-[#1E7F4F]" : "text-[#B3261E]"}`}>{m.text}</div> : null}
    </form>
  );
}
export function PF({ label, ...p }: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  const t = useT();
  const id = useId();
  return <div className="flex flex-col gap-1 text-[12.5px] font-medium text-muted"><label htmlFor={id}>{t(label)}</label><input id={id} {...p} className="h-11 rounded-lg border border-input px-3 text-[15px] bg-white" /></div>;
}
