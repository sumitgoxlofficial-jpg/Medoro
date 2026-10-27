"use client";
import { createContext, useCallback, useContext, useRef, useState } from "react";

type ToastTone = "red" | "green" | "amber" | "blue" | "gray";
const BG: Record<ToastTone, string> = { red: "#B3261E", green: "#1E7F4F", amber: "#94570A", blue: "#2459C9", gray: "#2B3036" };

const Ctx = createContext<(text: string, tone?: ToastTone) => void>(() => {});

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [t, setT] = useState<{ text: string; tone: ToastTone; id: number } | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const show = useCallback((text: string, tone: ToastTone = "gray") => {
    clearTimeout(timer.current);
    setT({ text, tone, id: Date.now() });
    timer.current = setTimeout(() => setT(null), 3400);
  }, []);
  return (
    <Ctx.Provider value={show}>
      {children}
      {t ? (
        <div role="status" key={t.id} className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[100] max-w-[min(560px,calc(100vw-32px))] px-4 py-2.5 rounded-[10px] text-white text-[13.5px] font-medium shadow-pop" style={{ background: BG[t.tone] }}>
          {t.text}
        </div>
      ) : null}
    </Ctx.Provider>
  );
}

export const useToast = () => useContext(Ctx);

/** Show the result of a server action as a toast. Returns true on success. */
export function useActionToast() {
  const toast = useToast();
  return useCallback(<T,>(r: { ok: true; data: T; message?: string } | { ok: false; error: string }, okTone: ToastTone = "green") => {
    if (r.ok) { if (r.message) toast(r.message, okTone); return true; }
    toast(r.error, "red");
    return false;
  }, [toast]);
}
