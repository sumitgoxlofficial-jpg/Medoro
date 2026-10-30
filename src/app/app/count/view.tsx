"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ClipboardCheck, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Empty } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { inr, inr0 } from "@/lib/money";
import { dayMonth, hhmm, monthYear } from "@/lib/dates";
import { postCountAction } from "./actions";

type Row = { id: string; name: string; rack: string | null; batchNo: string; expiry: string; system: number; cost: number };
const th = "text-left text-[12px] font-medium text-muted px-3.5 py-2.5 border-b border-[#E3E6E9] whitespace-nowrap";
const td = "px-3.5 py-2 border-b border-row";

export function CountView({ rows, recent }: { rows: Row[]; recent: { no: string; at: string; counted: number; changed: number; value: number }[] }) {
  const toast = useToast();
  const router = useRouter();
  const [zero, setZero] = useState(false);
  const [vals, setVals] = useState<Record<string, string>>({});
  const [q, setQ] = useState("");
  const [pending, start] = useTransition();
  const entered = Object.entries(vals).filter(([, v]) => v !== "");
  const variance = entered.reduce((a, [id, v]) => { const r = rows.find((x) => x.id === id); return a + (r ? (Number(v) - r.system) * r.cost : 0); }, 0);
  const shown = useMemo(() => rows.filter((r) => (zero || r.system > 0 || vals[r.id] != null) && (!q || r.name.toLowerCase().includes(q.toLowerCase()) || r.batchNo.includes(q.toUpperCase()) || (r.rack ?? "").toLowerCase() === q.toLowerCase())), [rows, q, zero, vals]);

  const post = () => {
    if (!entered.length) return toast("Enter counted quantities first.", "red");
    start(async () => {
      const r = await postCountAction(entered.map(([batchId, v]) => ({ batchId, counted: Number(v) })), "");
      if (!r.ok) return toast(r.error, "red");
      toast(`${r.data.no} posted. ${r.data.changed} batch adjustment${r.data.changed === 1 ? "" : "s"} recorded in the ledger.`, "green");
      setVals({});
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-3.5 max-w-[1400px]">
      <div className="bg-white border border-line rounded-xl px-4 py-3 flex items-center gap-4 flex-wrap shadow-[0_1px_2px_rgba(16,24,40,.04)]">
        <div className="relative w-[260px]"><Search size={15} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-fainter" /><input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Filter by name, batch or rack" className="w-full border border-input rounded-lg py-2 pl-8 pr-2 text-[13.5px] outline-none focus:border-teal" /></div>
        <span className="text-[13px] text-muted">{entered.length} of {shown.length} batches counted</span>
        <label className="flex items-center gap-1.5 text-[13px] text-muted"><input type="checkbox" checked={zero} onChange={(e) => setZero(e.target.checked)} /> Show zero-stock batches</label>
        <span className="text-[13px] font-semibold" style={{ color: variance < 0 ? "#B3261E" : "#1F2328" }}>Variance at cost: {inr(variance)}</span>
        <div className="ml-auto flex gap-2">
          <Button onClick={() => setVals(Object.fromEntries(shown.map((r) => [r.id, String(r.system)])))}>Prefill system qty</Button>
          <Button variant="primary" onClick={post} disabled={pending}>Post adjustments</Button>
        </div>
      </div>
      <div className="bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] overflow-auto">
        {rows.length ? (
          <table className="w-full border-collapse min-w-[760px] text-[14px]">
            <thead><tr className="bg-subtle"><th className={th}>Medicine · batch</th><th className={th}>Rack</th><th className={th}>Expiry</th><th className={th + " text-right"}>System</th><th className={th}>Counted</th><th className={th + " text-right"}>Variance</th><th className={th + " text-right"}>At cost</th></tr></thead>
            <tbody>
              {shown.map((r) => {
                const v = vals[r.id] ?? "", has = v !== "", d = has ? Number(v) - r.system : 0;
                return (
                  <tr key={r.id}>
                    <td className={td}><strong className="font-semibold">{r.name}</strong> <span className="font-mono text-[12.5px] text-muted">{r.batchNo}</span></td>
                    <td className={td + " text-muted"}>{r.rack ?? "—"}</td>
                    <td className={td + " text-muted"}>{monthYear(r.expiry)}</td>
                    <td className={td + " text-right tnum"}>{r.system}</td>
                    <td className={td}><input value={v} onChange={(e) => setVals({ ...vals, [r.id]: e.target.value.replace(/\D/g, "") })} inputMode="numeric" aria-label={`Counted ${r.name} ${r.batchNo}`} className="w-20 border border-input rounded-md px-2 py-1 text-right text-[14px] outline-none focus:border-teal" /></td>
                    <td className={td + " text-right tnum font-semibold"} style={{ color: d < 0 ? "#B3261E" : d > 0 ? "#1E7F4F" : "#5B636B" }}>{has ? (d > 0 ? "+" + d : String(d)) : ""}</td>
                    <td className={td + " text-right tnum"}>{has && d ? inr0(d * r.cost) : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : <Empty icon={ClipboardCheck} title="Nothing to count" body="There is no stock at this branch yet." />}
      </div>
      {recent.length ? (
        <div className="bg-white border border-line rounded-xl px-4 py-3">
          <div className="font-semibold text-[14.5px] mb-1">Recent counts</div>
          {recent.map((c) => <div key={c.no} className="flex gap-3 py-1.5 border-b border-row last:border-0 text-[13px]"><span className="font-mono text-[12px] w-[130px]">{c.no}</span><span className="text-muted flex-1">{dayMonth(new Date(c.at))} {hhmm(new Date(c.at))} · {c.counted} counted · {c.changed} adjusted</span><strong className="tnum" style={{ color: c.value < 0 ? "#B3261E" : undefined }}>{inr(c.value)}</strong></div>)}
        </div>
      ) : null}
      <div className="text-[12px] text-faint">Each adjustment is the counted quantity minus the system quantity at the moment you post, so post soon after counting and avoid selling counted batches in between. Variance at cost posts to Stock loss.</div>
    </div>
  );
}
