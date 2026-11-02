"use client";
import { Fragment, useState, useTransition } from "react";
import { Download, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { cancelDeletionAction, requestDeletionAction } from "./actions";
import { useLang, useT } from "@/lib/i18n-client";
import { localeOf, type Lang } from "@/lib/tr";

const day = (iso: string, lang: Lang) => new Date(iso).toLocaleDateString(localeOf(lang), { day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Kolkata" });

/** Owner-only: close the pharmacy account after a waiting period that can be cancelled. */
export function DeleteAccountCard({ code, plan, isOwner, waitDays }: { code: string; plan: { scheduledFor: string; by: string } | null; isOwner: boolean; waitDays: number }) {
  const toast = useToast();
  const t = useT(), lang = useLang();
  const [pending, start] = useTransition();
  const [downloaded, setDownloaded] = useState(false);
  const [typed, setTyped] = useState("");

  return (
    <div className="bg-white border border-[#F0C8C3] rounded-xl p-5 flex flex-col gap-3 max-w-[1200px]">
      <div className="flex items-center gap-2 font-semibold text-[15px] text-[#8C1D18]"><Trash2 size={17} />{t("Delete pharmacy account")}</div>
      {plan ? (
        <>
          <div className="text-[13.5px] bg-[#FBEAE8] text-[#8C1D18] rounded-lg p-3">
            {t("This pharmacy and all its data will be permanently deleted on {date} (requested by {name}). Until then everything works as usual.", { date: day(plan.scheduledFor, lang), name: plan.by })}
          </div>
          {isOwner ? (
            <Button className="self-start" disabled={pending} onClick={() => start(async () => { const r = await cancelDeletionAction(); toast(r.ok ? r.message! : r.error, r.ok ? "green" : "red"); })}>Cancel deletion</Button>
          ) : <div className="text-[13px] text-muted">{t("Only the owner can cancel it.")}</div>}
        </>
      ) : !isOwner ? (
        <div className="text-[13.5px] text-muted">{t("Only the pharmacy owner can delete the account.")}</div>
      ) : (
        <>
          <div className="text-[13.5px] text-ink-2">
            {t("Deletes the pharmacy, all branches, staff accounts, stock, sales, customers and accounts from Medoro. You get {n} days to change your mind; after that it can’t be undone.", { n: waitDays })}
            {" "}{t("Backups in your own Google Drive stay yours. Medoro keeps only its own record of your subscription payments, as tax law requires.")}
          </div>
          <div className="text-[13px] text-muted">{t("Keep a copy first: sale and purchase records must usually be kept for 8 years under GST law.")}</div>
          <div className="flex gap-2 flex-wrap">
            <a href="/api/export?format=json" className="flex items-center gap-1.5 border border-input rounded-lg px-3 min-h-10 text-[13.5px] text-ink no-underline hover:border-teal hover:text-ink" onClick={() => setDownloaded(true)}><Download size={15} />{t("Download all data (JSON)")}</a>
            <a href="/api/export?format=csv" className="flex items-center gap-1.5 border border-input rounded-lg px-3 min-h-10 text-[13.5px] text-ink no-underline hover:border-teal hover:text-ink" onClick={() => setDownloaded(true)}><Download size={15} />{t("Download all data (CSV)")}</a>
          </div>
          <label className="flex items-start gap-2 text-[13.5px]"><input type="checkbox" className="accent-teal size-4 mt-0.5 flex-none" checked={downloaded} onChange={(e) => setDownloaded(e.target.checked)} />{t("I’ve downloaded my data, or I don’t need it.")}</label>
          <label className="flex flex-col gap-1 text-[13px] text-muted max-w-[360px]">{t("Type your pharmacy code {code} to confirm").split(/\{code\}/).map((x, i) => i ? <Fragment key={i}><span className="font-mono text-ink">{code}</span>{x}</Fragment> : x)}
            <input value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" aria-label={t("Pharmacy code to confirm deletion")} className="h-10 border border-input rounded-lg px-3 text-[14px] text-ink outline-none focus:border-teal font-mono uppercase" />
          </label>
          <Button variant="danger" className="self-start" disabled={pending || !downloaded || typed.trim().toUpperCase() !== code.toUpperCase()}
            onClick={() => start(async () => {
              const r = await requestDeletionAction(typed, downloaded);
              toast(r.ok ? t("Deletion scheduled for {date}. You can cancel it until then.", { date: day(r.data, lang) }) : r.error, r.ok ? "amber" : "red");
            })}>
            {t("Delete pharmacy in {n} days", { n: waitDays })}
          </Button>
        </>
      )}
    </div>
  );
}
