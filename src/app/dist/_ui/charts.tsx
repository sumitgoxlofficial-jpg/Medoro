"use client";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const rupees = (p: number) => "₹" + Math.round(p / 100).toLocaleString("en-IN");
const short = (p: number) => { const r = p / 100; return r >= 1e7 ? `${(r / 1e7).toFixed(1)}Cr` : r >= 1e5 ? `${(r / 1e5).toFixed(1)}L` : r >= 1e3 ? `${(r / 1e3).toFixed(0)}k` : `${Math.round(r)}`; };

export function TrendChart({ data }: { data: { day: string; sales: number }[] }) {
  return (
    <div className="h-[220px] w-full" role="img" aria-label="Sales, last 30 days">
      <ResponsiveContainer>
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs><linearGradient id="dg" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#1F4E8C" stopOpacity={0.22} /><stop offset="100%" stopColor="#1F4E8C" stopOpacity={0} /></linearGradient></defs>
          <CartesianGrid stroke="#EEF1F5" vertical={false} />
          <XAxis dataKey="day" tickFormatter={(d: string) => d.slice(8)} tick={{ fontSize: 11, fill: "#6B7A90" }} axisLine={false} tickLine={false} interval={4} />
          <YAxis tickFormatter={short} tick={{ fontSize: 11, fill: "#6B7A90" }} axisLine={false} tickLine={false} width={44} />
          <Tooltip formatter={(v) => rupees(Number(v))} labelStyle={{ color: "#0B2545" }} contentStyle={{ borderRadius: 8, border: "1px solid #E3E7ED", fontSize: 12 }} />
          <Area type="monotone" dataKey="sales" stroke="#1F4E8C" strokeWidth={2} fill="url(#dg)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export function BarsChart({ data, label }: { data: { name: string; value: number }[]; label: string }) {
  return (
    <div className="h-[240px] w-full" role="img" aria-label={label}>
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke="#EEF1F5" vertical={false} />
          <XAxis dataKey="name" tick={{ fontSize: 11, fill: "#6B7A90" }} axisLine={false} tickLine={false} />
          <YAxis tickFormatter={short} tick={{ fontSize: 11, fill: "#6B7A90" }} axisLine={false} tickLine={false} width={44} />
          <Tooltip formatter={(v) => rupees(Number(v))} contentStyle={{ borderRadius: 8, border: "1px solid #E3E7ED", fontSize: 12 }} />
          <Bar dataKey="value" fill="#1F4E8C" radius={[3, 3, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
