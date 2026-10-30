"use client";
import { useState } from "react";
import { Download } from "lucide-react";
import { Segmented } from "@/components/ui/segmented";
import { Button } from "@/components/ui/button";
import { inr0 } from "@/lib/money";
import { downloadCsv } from "@/lib/csv";
import type { MarginBy, MarginRow, stockMargins } from "@/domain/reports/margins";

const card = "bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)]";
const th = "text-left text-[12px] font-medium text-muted px-3 py-2 border-b border-[#E3E6E9] whitespace-nowrap";
const td = "px-3 py-1.5 border-b border-row";
const pct = (p: number | null) => (p == null ? "—" : `${p.toFixed(1)}%`);

/** Realised margins on landed cost for the last 30 days, by item, category or supplier, and the margin on stock in hand. */
export function Margins({ sales, stock }: { sales: Record<MarginBy, MarginRow[]>; stock: Awaited<ReturnType<typeof stockMargins>> }) {
  const [by, setBy] = useState<MarginBy | "stock">("item");
  const rows = by === "stock" ? null : sales[by];
  const tot = rows?.reduce((a, r) => ({ sales: a.sales + r.sales, cost: a.cost + r.cost }), { sales: 0, cost: 0 });
  const csv = () => downloadCsv(`margins-${by}`, by === "stock"
    ? [["Medicine", "Units", "Value at MRP ex-GST", "Landed cost", "Margin", "Margin %"], ...stock.map((r) => [r.name, r.qty, (r.sell / 100).toFixed(2), (r.cost / 100).toFixed(2), (r.margin / 100).toFixed(2), r.pct ?? ""])]
    : [[by === "item" ? "Medicine" : by === "category" ? "Category" : "Supplier", "Units sold", "Sales ex-GST", "Landed cost", "Margin", "Margin %"], ...rows!.map((r) => [r.name, r.qty, (r.sales / 100).toFixed(2), (r.cost / 100).toFixed(2), (r.margin / 100).toFixed(2), r.pct ?? ""])]);
  return (
    <div className={card + " overflow-auto"}>
      <div className="flex items-center gap-3 px-4 pt-3 pb-2 flex-wrap">
        <div className="flex flex-col"><span className="font-semibold text-[15px]">Margins on landed cost</span><span className="text-[12px] text-faint">{by === "stock" ? "Stock in hand: MRP excluding GST against each batch’s landed cost" : "Last 30 days, net of returns: sales excluding GST against landed cost (after schemes, discounts and free goods)"}</span></div>
        <Segmented size="sm" value={by} onChange={setBy} className="ml-auto bg-[#EEF0F2]" options={[{ value: "item", label: "Item" }, { value: "category", label: "Category" }, { value: "supplier", label: "Supplier" }, { value: "stock", label: "Stock in hand" }]} />
        <Button size="sm" onClick={csv}><Download size={13} />CSV</Button>
      </div>
      <table className="w-full border-collapse text-[13px] min-w-[640px]">
        <thead><tr className="bg-subtle"><th className={th}>{by === "supplier" ? "Supplier" : by === "category" ? "Category (form)" : "Medicine"}</th><th className={th + " text-right"}>Units</th><th className={th + " text-right"}>{by === "stock" ? "At MRP ex-GST" : "Sales ex-GST"}</th><th className={th + " text-right"}>Landed cost</th><th className={th + " text-right"}>Margin</th><th className={th + " text-right"}>Margin %</th></tr></thead>
        <tbody>
          {(by === "stock" ? stock.map((r) => ({ key: r.id, name: r.name, qty: r.qty, sales: r.sell, cost: r.cost, margin: r.margin, pct: r.pct })) : rows!).slice(0, 50).map((r) => (
            <tr key={r.key}><td className={td}>{r.name}</td><td className={td + " text-right tnum"}>{r.qty}</td><td className={td + " text-right tnum"}>{inr0(r.sales)}</td><td className={td + " text-right tnum"}>{inr0(r.cost)}</td><td className={td + " text-right tnum"}>{inr0(r.margin)}</td>
              <td className={td + " text-right tnum font-semibold"} style={{ color: (r.pct ?? 0) < 10 ? "#B3261E" : (r.pct ?? 0) < 20 ? "#94570A" : "#1E7F4F" }}>{pct(r.pct)}</td></tr>
          ))}
          {tot && rows!.length ? <tr className="bg-subtle font-semibold"><td className={td}>Total</td><td className={td} /><td className={td + " text-right tnum"}>{inr0(tot.sales)}</td><td className={td + " text-right tnum"}>{inr0(tot.cost)}</td><td className={td + " text-right tnum"}>{inr0(tot.sales - tot.cost)}</td><td className={td + " text-right tnum"}>{pct(tot.sales ? Math.round(((tot.sales - tot.cost) / tot.sales) * 10000) / 100 : null)}</td></tr> : null}
        </tbody>
      </table>
      {(by === "stock" ? !stock.length : !rows!.length) ? <div className="px-4 py-3 text-[13px] text-fainter">{by === "stock" ? "No stock in hand." : "No sales in the last 30 days."}</div> : null}
    </div>
  );
}
