"use client";
// Charts drawn like the pharmacy dashboard's "Sales, last 14 days": teal bars that grow in (app-bar), today's bar
// in the brand teal, earlier days in a soft tint, zero days grey.
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { inr0 } from "@/lib/money";

export function TrendChart({ data }: { data: { day: string; sales: number }[] }) {
  const mx = Math.max(1, ...data.map((d) => d.sales));
  return (
    <div className="flex items-end gap-1 max-sm:gap-0.5 h-[190px]" role="img" aria-label="Sales by day">
      {data.map((h, i) => {
        const last = i === data.length - 1;
        return (
          <div key={h.day} title={`${h.day} · ${inr0(h.sales)}`} className="flex-1 flex flex-col items-center gap-1 justify-end h-full min-w-0">
            <div className="text-[11px] font-semibold text-teal whitespace-nowrap">{last && h.sales ? inr0(h.sales) : ""}</div>
            <div className="app-bar w-full max-w-6 rounded-t" style={{ height: Math.max(h.sales ? 4 : 2, Math.round((h.sales / mx) * 150)), background: last ? "#0B5E5B" : h.sales ? "#B5D9D4" : "#EEF0F2", ["--d" as string]: i }} />
            <div className={"text-[10.5px] text-fainter" + (i % 3 && !last ? " invisible" : "")}>{Number(h.day.slice(8))}</div>
          </div>
        );
      })}
    </div>
  );
}

const short = (p: number) => { const r = p / 100; return r >= 1e7 ? `${(r / 1e7).toFixed(1)}Cr` : r >= 1e5 ? `${(r / 1e5).toFixed(1)}L` : r >= 1e3 ? `${(r / 1e3).toFixed(0)}k` : `${Math.round(r)}`; };

export function BarsChart({ data, label }: { data: { name: string; value: number }[]; label: string }) {
  return (
    <div className="h-[240px] w-full" role="img" aria-label={label}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#EEF0F2" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#6B737B" }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={short} tick={{ fontSize: 11, fill: "#6B737B" }} axisLine={false} tickLine={false} width={44} />
          <Tooltip formatter={(v) => inr0(Number(v))} contentStyle={{ borderRadius: 8, border: "1px solid #E6E8EB", fontSize: 12 }} cursor={{ fill: "#F2F9F8" }} />
          <Bar dataKey="value" fill="#0B5E5B" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
