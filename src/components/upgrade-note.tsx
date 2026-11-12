"use client";
import Link from "next/link";
import { Lock } from "lucide-react";
import { useT } from "@/lib/i18n-client";

/** Shown in place of a screen or panel the pharmacy's plan does not include. */
export function UpgradeNote({ message, canUpgrade, compact }: { message: string; canUpgrade: boolean; compact?: boolean }) {
  const t = useT();
  return (
    <div role="note" className={`bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] flex items-start gap-3 ${compact ? "p-4" : "p-6 max-w-[640px]"}`}>
      <span className="size-9 rounded-lg bg-chip flex items-center justify-center flex-none"><Lock size={16} aria-hidden /></span>
      <div className="flex flex-col gap-1.5 min-w-0">
        <div className="font-semibold text-[14.5px]">{t("Not included in your plan")}</div>
        <div className="text-[13.5px] text-muted">{message}</div>
        {canUpgrade ? <Link href="/app/plan" className="text-teal font-semibold text-[13.5px] no-underline w-fit">{t("See plans")}</Link> : <div className="text-[12.5px] text-faint">{t("Ask the owner to upgrade the plan.")}</div>}
      </div>
    </div>
  );
}
