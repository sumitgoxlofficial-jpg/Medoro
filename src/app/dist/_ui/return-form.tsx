"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n-client";
import { inr } from "@/lib/money";
import { Btn } from "./forms";
import { returnAction } from "../actions";

type L = { id: string; name: string; batchNo: string; qty: number; freeQty: number; returned: number; taxable: number; tax: number };

export function ReturnForm({ invoiceId, lines }: { invoiceId: string; lines: L[] }) {
  const t = useT();
  const router = useRouter();
  const [st, setSt] = useState<Record<string, { qty: number; condition: "saleable" | "expired" | "damaged"; pct: number }>>({});
  const [reason, setReason] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const chosen = Object.entries(st).filter(([, v]) => v.qty > 0);
  const est = chosen.reduce((a, [id, v]) => { const l = lines.find((x) => x.id === id)!; const n = l.qty + l.freeQty; return a + Math.round(((l.taxable + l.tax) * v.qty / n) * v.pct / 100); }, 0);
  return (
    <div className="flex flex-col gap-3">
      <table className="w-full text-[13px]"><thead><tr className="text-[11.5px] uppercase text-muted"><th className="text-left py-1">{t("Line")}</th><th className="text-right">{t("Can return")}</th><th className="text-right">{t("Return")}</th><th>{t("Condition")}</th><th className="text-right">{t("Credit %")}</th></tr></thead>
        <tbody>{lines.map((l) => {
          const can = l.qty + l.freeQty - l.returned, v = st[l.id] ?? { qty: 0, condition: "saleable" as const, pct: 100 };
          const set = (p: Partial<typeof v>) => setSt((s) => ({ ...s, [l.id]: { ...v, ...p } }));
          return (
            <tr key={l.id} className="border-t border-line-soft">
              <td className="py-1.5">{l.name} <span className="text-muted">{l.batchNo}</span></td>
              <td className="text-right tnum">{can}</td>
              <td className="text-right"><input type="number" min={0} max={can} disabled={!can} value={v.qty || ""} onChange={(e) => set({ qty: Math.min(can, Math.max(0, Math.floor(Number(e.target.value) || 0))) })} className="h-8 w-[64px] text-right border border-input rounded px-1" /></td>
              <td className="text-center"><select value={v.condition} onChange={(e) => set({ condition: e.target.value as typeof v.condition })} className="h-8 border border-input rounded text-[12.5px]"><option value="saleable">{t("Saleable")}</option><option value="expired">{t("Expired")}</option><option value="damaged">{t("Damaged")}</option></select></td>
              <td className="text-right"><input type="number" min={0} max={100} value={v.pct} onChange={(e) => set({ pct: Math.min(100, Math.max(0, Number(e.target.value) || 0)) })} className="h-8 w-[60px] text-right border border-input rounded px-1" /></td>
            </tr>
          );
        })}</tbody></table>
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("Reason (printed on the credit note)")} className="h-9 border border-input rounded-md px-2 text-[13px]" />
      <div className="flex items-center gap-3">
        <Btn variant="primary" disabled={pending || !chosen.length} onClick={() => start(async () => {
          const r = await returnAction({ invoiceId, reason, lines: chosen.map(([id, v]) => ({ invoiceLineId: id, qty: v.qty, condition: v.condition, creditPct: v.pct })) });
          if (r.ok) { setMsg({ ok: true, text: t(r.message ?? "Saved.") }); setSt({}); setReason(""); router.refresh(); } else setMsg({ ok: false, text: t(r.error) });
        })}>{t("Issue credit note")} · {inr(est)}</Btn>
        {msg ? <span className={`text-[12.5px] ${msg.ok ? "text-[#1E7F4F]" : "text-[#B3261E]"}`}>{msg.text}</span> : null}
      </div>
    </div>
  );
}
