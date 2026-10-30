"use client";
import { useState, useTransition } from "react";
import { Network } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { inr0 } from "@/lib/money";
import type { centralBuying } from "@/domain/intelligence/service";
import { centralAction } from "./actions";

const card = "bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)]";
const th = "text-left text-[12px] font-medium text-muted px-3 py-2 border-b border-[#E3E6E9] whitespace-nowrap";
const td = "px-3 py-2 border-b border-row";

/** Owner view across branches: one consolidated order per supplier with each branch's share, and one click to draft them. */
export function CentralBuying({ plan, suppliers, policy, canPurchase }: { plan: Awaited<ReturnType<typeof centralBuying>>; suppliers: { id: string; name: string }[]; policy: { cover: number; safety: number }; canPurchase: boolean }) {
  const toast = useToast();
  const [fallback, setFallback] = useState(suppliers[0]?.id ?? "");
  const [done, setDone] = useState<{ no: string; branch: string; supplier: string }[] | null>(null);
  const [pending, start] = useTransition();
  const unassigned = plan.suppliers.some((s) => !s.supplierId);
  const total = plan.suppliers.reduce((a, s) => a + s.value, 0);
  return (
    <div className={card + " p-4 flex flex-col gap-3"}>
      <div className="flex items-center gap-3 flex-wrap">
        <span className="size-8 rounded-lg bg-teal-tint text-teal flex items-center justify-center"><Network size={16} /></span>
        <div className="flex flex-col flex-1 min-w-[240px]"><div className="font-semibold text-[15px]">Central buying · all branches</div>
          <div className="text-[12.5px] text-muted">Reorder needs from {plan.branches.length} branches under the {policy.cover}-day policy, combined per supplier so you can negotiate one order. Each branch gets its own draft PO, delivered to that branch.</div></div>
        {canPurchase && plan.suppliers.length ? (
          <div className="flex items-center gap-2 flex-wrap">
            {unassigned ? <select value={fallback} onChange={(e) => setFallback(e.target.value)} aria-label="Default supplier" className="border border-input rounded-md px-2 py-1.5 text-[13px] bg-white"><option value="">Default supplier…</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select> : null}
            <Button variant="primary" disabled={pending} onClick={() => start(async () => { const r = await centralAction(unassigned ? fallback || null : null); if (!r.ok) return toast(r.error, "red"); setDone(r.data); toast(`${r.data.length} draft PO(s) created across branches.`, "green"); })}>Create POs for every branch</Button>
          </div>
        ) : null}
      </div>
      {done ? <div className="bg-teal-soft border border-teal-line rounded-lg px-3 py-2 text-[13px]">{done.map((d) => `${d.no} · ${d.supplier} → ${d.branch}`).join("  ·  ")}. Review and place them under Purchases at each branch.</div> : null}
      {plan.suppliers.length ? plan.suppliers.map((s) => (
        <div key={s.supplierId ?? "none"} className="border border-line rounded-lg overflow-auto">
          <div className="flex items-center justify-between px-3 py-2 bg-subtle text-[13.5px]"><strong>{s.supplier}</strong><span className="tnum text-muted">{s.lines.length} item(s) · about {inr0(s.value)}</span></div>
          <table className="w-full border-collapse text-[13px] min-w-[560px]">
            <thead><tr><th className={th}>Medicine</th>{plan.branches.map((b) => <th key={b.id} className={th + " text-right"}>{b.name}</th>)}<th className={th + " text-right"}>Total</th></tr></thead>
            <tbody>{s.lines.map((l) => (
              <tr key={l.medicineId}><td className={td}>{l.name}</td>{plan.branches.map((b) => <td key={b.id} className={td + " text-right tnum"}>{l.qty[b.id] ? l.qty[b.id] : <span className="text-fainter">—</span>}</td>)}<td className={td + " text-right tnum font-semibold"}>{l.total}</td></tr>
            ))}</tbody>
          </table>
        </div>
      )) : <div className="text-[13px] text-muted bg-subtle rounded-lg px-3 py-2.5">No branch needs reordering under this policy.</div>}
      {plan.suppliers.length ? <div className="text-[12px] text-faint">Estimated value {inr0(total)} at last purchase cost. Quantities come from each branch’s own 28-day sales rate and stock.</div> : null}
    </div>
  );
}
