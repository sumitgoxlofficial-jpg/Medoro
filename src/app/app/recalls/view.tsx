"use client";
import { useState, useTransition } from "react";
import { ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, type Tone } from "@/components/ui/badge";
import { useToast } from "@/components/ui/toast";
import { dayMonth } from "@/lib/dates";
import type { listRecalls } from "@/domain/inventory/recalls";
import { addRecallAction, quarantineRecallAction, recallStatusAction } from "./actions";

type R = Awaited<ReturnType<typeof listRecalls>>[number];
const ST: Record<string, [string, Tone]> = { open: ["Open", "red"], investigating: ["Investigating", "amber"], supplier_return: ["Supplier return raised", "amber"], resolved: ["Resolved", "green"] };
const inp = "border border-input rounded-lg px-3 py-2 text-[13.5px] outline-none bg-white focus:border-teal";

export function RecallsView({ recalls, canAdjust, canRecord, today, medicines }: { recalls: R[]; canAdjust: boolean; canRecord: boolean; today: string; medicines: { id: string; label: string }[] }) {
  const toast = useToast();
  const blank = { product: "", medicineId: "", batches: "", source: "", publishedAt: "", reason: "" };
  const [f, setF] = useState(blank);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-3.5 max-w-[1100px]">
      <div className="text-[13px] text-ink-2 bg-teal-soft border border-teal-line rounded-[10px] px-3.5 py-2.5">Record only notices from verified sources (CDSCO, state drug controller, manufacturer). Medoro never generates recall notices. It matches the medicine and batch numbers in the notice against stock in every branch.</div>
      {recalls.length ? recalls.map((r) => {
        const [label, tone] = ST[r.status] ?? [r.status, "gray"];
        const live = r.matches.filter((m) => m.sellable);
        return (
          <div key={r.id} className="bg-white border border-line rounded-xl px-4 py-3.5 flex flex-col gap-1.5 shadow-[0_1px_2px_rgba(16,24,40,.04)]">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className="font-mono text-[12.5px] text-muted">{r.ref}</span><strong className="text-[15px]">{r.product}</strong><Badge tone={tone}>{label}</Badge>
              {canRecord ? (
                <select value={r.status} aria-label="Status" onChange={(e) => start(async () => { const x = await recallStatusAction(r.id, e.target.value as never); if (!x.ok) toast(x.error, "red"); })} className="ml-auto border border-input rounded-md px-2 py-1 text-[12.5px] bg-white">
                  {Object.entries(ST).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}
                </select>
              ) : null}
            </div>
            <div className="text-[13.5px] text-ink-2">{r.reason} · batches {r.batchNos.join(", ")}</div>
            <div className="text-[12.5px] text-faint">Source: {r.source} · published {dayMonth(new Date(r.publishedAt + "T00:00:00Z"), true)}</div>
            <div className="flex items-center gap-3 flex-wrap pt-1">
              <span className="text-[13px]" style={{ color: live.length ? "#B3261E" : "#1E7F4F" }}>
                {r.matches.length ? r.matches.map((m) => `${m.branch}: ${m.medicine} ${m.batchNo} · ${m.qty} units · ${m.sellable ? "SELLABLE" : m.status}`).join("  |  ") : "No matching stock in any branch"}
              </span>
              {canAdjust && live.length ? <Button size="sm" variant="danger" className="ml-auto" disabled={pending} onClick={() => start(async () => { const x = await quarantineRecallAction(r.id); toast(x.ok ? `${x.data} batch(es) quarantined and blocked at POS.` : x.error, x.ok ? "green" : "red"); })}>Quarantine affected stock</Button> : null}
            </div>
          </div>
        );
      }) : (
        <div className="bg-white border border-line rounded-xl py-8 flex flex-col items-center gap-2 text-center"><ShieldAlert size={24} className="text-fainter" /><div className="font-semibold">No recall notices recorded</div><div className="text-[13px] text-faint">When a notice arrives, record it here and Medoro checks every branch for the batches.</div></div>
      )}
      {canRecord ? (
        <div className="bg-white border border-line rounded-xl px-4 py-3.5 flex flex-col gap-2.5">
          <div className="font-semibold text-[14.5px]">Record a verified notice</div>
          <div className="grid gap-2 grid-cols-[repeat(auto-fit,minmax(220px,1fr))]">
            <input className={inp} list="recall-meds" value={f.product} onChange={(e) => setF({ ...f, product: e.target.value, medicineId: medicines.find((m) => m.label === e.target.value)?.id ?? "" })} placeholder="Medicine & strength (from catalogue) *" aria-label="Medicine" />
            <datalist id="recall-meds">{medicines.map((m) => <option key={m.id} value={m.label} />)}</datalist>
            <input className={inp + " font-mono"} value={f.batches} onChange={(e) => setF({ ...f, batches: e.target.value.toUpperCase() })} placeholder="Affected batches, comma separated *" aria-label="Batches" />
            <input className={inp} value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })} placeholder="Source & reference no. *" aria-label="Source" />
            <input className={inp} type="date" max={today} value={f.publishedAt} onChange={(e) => setF({ ...f, publishedAt: e.target.value })} aria-label="Published on" />
            <input className={inp} value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="Reason as stated in notice" aria-label="Reason" />
          </div>
          <Button variant="primary" className="self-start" disabled={pending} onClick={() => start(async () => { const x = await addRecallAction({ medicineId: f.medicineId, batches: f.batches, source: f.source, publishedAt: f.publishedAt, reason: f.reason }); if (!x.ok) return toast(x.error, "red"); toast(`${x.data} recorded and matched against stock.`, "green"); setF(blank); })}>Record & match stock</Button>
        </div>
      ) : null}
    </div>
  );
}
