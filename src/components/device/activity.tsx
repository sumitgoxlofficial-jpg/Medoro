"use client";
import { useEffect, useRef, useState } from "react";
import { deviceDb } from "@/drivedb/device";
import { inr } from "@/lib/money";
import { useT } from "@/lib/i18n-client";
import { dayMonth, hhmm } from "@/lib/dates";
import { card, input } from "./ui";

type Row = { at: string; who: string; kind: string; what: string; amountPaise: number | null };

/** Who did what on this pharmacy's counters, newest first (bills, returns, money, stock changes, orders). */
export function Activity({ refresh }: { refresh: number }) {
  const t = useT();
  const dev = useRef(deviceDb()).current;
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  useEffect(() => { const t = setTimeout(() => dev.call("activityLog", { text: q, limit: 300 }).then(setRows), 150); return () => clearTimeout(t); }, [dev, q, refresh]);
  return (
    <div className={card}>
      <div className="flex justify-between items-center gap-2 flex-wrap">
        <div className="font-semibold">{t("Activity")}</div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Search: a name, bill no., medicine…")} aria-label={t("Search activity")} className={`${input} max-w-xs`} />
      </div>
      <div className="text-[13px] text-muted">{t("Every counter’s work appears here after it syncs. Bills, payments and stock movements can’t be edited or deleted, so this list stays complete.")}</div>
      <ul className="text-sm divide-y divide-line">
        {rows.map((r, i) => (
          <li key={i} className="py-1.5 flex justify-between gap-3">
            <span><span className="text-muted tabular-nums">{dayMonth(new Date(r.at))} {hhmm(new Date(r.at))}</span> · {r.who ? <b>{t(r.who)}</b> : null}{r.who ? " · " : ""}{t(r.what)}</span>
            {r.amountPaise != null && <span className={`tabular-nums whitespace-nowrap ${r.amountPaise < 0 ? "text-bad" : ""}`}>{r.amountPaise < 0 ? "−" : ""}{inr(Math.abs(r.amountPaise))}</span>}
          </li>
        ))}
        {!rows.length && <li className="py-1.5 text-muted">{t("Nothing yet.")}</li>}
      </ul>
    </div>
  );
}
