"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { cn } from "@/components/ui/cn";
import { useLang } from "@/lib/i18n-client";
import type { Lang } from "@/lib/tr";
import { setLang } from "@/app/app/actions";

/** EN / हिंदी for screens before sign-in. Sets the same `medoro_lang` cookie as the switch in the app header. */
export function LangSwitch({ className }: { className?: string }) {
  const lang = useLang();
  const router = useRouter();
  const [pending, start] = useTransition();
  const pick = (l: Lang) => { if (l !== lang) start(async () => { await setLang(l); router.refresh(); }); };
  const b = (l: Lang, label: string) => (
    <button key={l} type="button" lang={l} aria-pressed={lang === l} disabled={pending} onClick={() => pick(l)}
      className={cn("h-[26px] px-2.5 rounded-[5px] text-[12.5px] font-semibold cursor-pointer text-ink disabled:cursor-wait", lang === l ? "bg-white shadow-[0_1px_2px_rgba(16,24,40,.12)]" : "bg-transparent")}>{label}</button>
  );
  return <div role="group" aria-label="Language / भाषा" className={cn("inline-flex gap-px bg-chip p-0.5 rounded-[7px]", className)}>{b("en", "EN")}{b("hi", "हिंदी")}</div>;
}
