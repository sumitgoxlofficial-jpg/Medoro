"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n-client";
import { Btn } from "./forms";
import { approveOrderAction } from "../actions";

export function ApproveForm({ orderId, held, canOverride, reasons }: { orderId: string; held: boolean; canOverride: boolean; reasons: string[] }) {
  const t = useT();
  const router = useRouter();
  const [reason, setReason] = useState("");
  const [partial, setPartial] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-2 min-w-[260px]">
      {held ? <div className="text-[12.5px] text-[#94570A] bg-[#FDF2E1] rounded-md px-2.5 py-2">{t("Credit hold")}: {reasons.map((r) => t(r)).join(" ")}</div> : null}
      {held && canOverride ? <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("Reason to override (audited)")} className="h-9 rounded-md border border-[#C9D2DE] px-2 text-[13px]" /> : null}
      <label className="flex items-center gap-2 text-[12.5px]"><input type="checkbox" checked={partial} onChange={(e) => setPartial(e.target.checked)} />{t("Cut short lines to available stock")}</label>
      <Btn variant="primary" disabled={pending || (held && !canOverride)} onClick={() => start(async () => {
        const r = await approveOrderAction(orderId, reason, partial);
        if (r.ok) { setErr(null); router.refresh(); } else setErr(t(r.error));
      })}>{pending ? t("Working…") : held ? t("Override & approve") : t("Approve & reserve stock")}</Btn>
      {err ? <div role="alert" className="text-[12.5px] text-[#B3261E]">{err}</div> : null}
    </div>
  );
}
