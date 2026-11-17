"use client";
import { useState, useTransition } from "react";
import { draftForecastAction } from "./actions";

export function DraftButton({ suppliers, canPurchase, count, lowCount }: { suppliers: { id: string; name: string }[]; canPurchase: boolean; count: number; lowCount: number }) {
  const [pending, start] = useTransition();
  const [fallback, setFallback] = useState("");
  const [low, setLow] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  if (!canPurchase) return <p className="m-0 text-[12.5px] text-slate-500">Drafting orders needs the purchases permission.</p>;
  return (
    <div className="flex items-center gap-3 flex-wrap" data-testid="forecast-draft">
      <select aria-label="Supplier for items with none on record" className="border border-line rounded-lg px-2 py-1.5 text-[13px] bg-white" value={fallback} onChange={(e) => setFallback(e.target.value)}>
        <option value="">Supplier for items with none on record…</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
      </select>
      {lowCount ? <label className="text-[12.5px] flex items-center gap-1"><input type="checkbox" checked={low} onChange={(e) => setLow(e.target.checked)} /> Include {lowCount} low-confidence item(s)</label> : null}
      <button className="rounded-lg border border-line px-3 py-1.5 text-[13px] hover:bg-slate-50 disabled:opacity-50" disabled={pending || !count}
        onClick={() => start(async () => { const r = await draftForecastAction(fallback || null, low); setMsg(r.ok ? { ok: true, text: `Draft order(s) ${r.data.orders.join(", ")} created. They are drafts: review before placing.${r.data.skippedLowConfidence.length ? ` ${r.data.skippedLowConfidence.length} low-confidence item(s) left out.` : ""}` } : { ok: false, text: r.error }); })}>
        Draft purchase orders
      </button>
      {msg ? <span role="status" className={`text-[12.5px] ${msg.ok ? "text-emerald-700" : "text-red-700"}`}>{msg.text}</span> : null}
    </div>
  );
}
