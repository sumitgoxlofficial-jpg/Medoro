"use client";
import { Bar, BarChart, CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

// Single-series charts in the console's teal; values in tooltips. Data always comes from the server.
const TEAL = "#0B5E5B", NAVY = "#0B3A78";
const axis = { fontSize: 11.5, fill: "#6B7480" };

export function HBar({ data, height = 260, color = TEAL }: { data: { name: string; n: number }[]; height?: number; color?: string }) {
  if (!data.length) return <div className="px-4 py-8 text-center text-muted text-[13px]">No data yet.</div>;
  return (
    <div className="px-2 py-3" style={{ height: Math.max(height, data.length * 26 + 30) }}>
      <ResponsiveContainer>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24 }}>
          <CartesianGrid horizontal={false} stroke="#EEF0F2" />
          <XAxis type="number" tick={axis} allowDecimals={false} />
          <YAxis type="category" dataKey="name" tick={axis} width={150} />
          <Tooltip cursor={{ fill: "#F2F9F8" }} />
          <Bar dataKey="n" name="Count" fill={color} radius={[0, 4, 4, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function VBar({ data, x, y, label, color = NAVY }: { data: Record<string, string | number>[]; x: string; y: string; label: string; color?: string }) {
  if (!data.length) return <div className="px-4 py-8 text-center text-muted text-[13px]">No data yet.</div>;
  return (
    <div className="px-2 py-3 h-[260px]">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ left: 0, right: 12 }}>
          <CartesianGrid vertical={false} stroke="#EEF0F2" />
          <XAxis dataKey={x} tick={axis} />
          <YAxis tick={axis} allowDecimals={false} />
          <Tooltip cursor={{ fill: "#F2F9F8" }} />
          <Bar dataKey={y} name={label} fill={color} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Trend({ data, x, y, label }: { data: Record<string, string | number>[]; x: string; y: string; label: string }) {
  if (!data.length) return <div className="px-4 py-8 text-center text-muted text-[13px]">No data yet.</div>;
  return (
    <div className="px-2 py-3 h-[240px]">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ left: 0, right: 12 }}>
          <CartesianGrid vertical={false} stroke="#EEF0F2" />
          <XAxis dataKey={x} tick={axis} />
          <YAxis tick={axis} allowDecimals={false} />
          <Tooltip />
          <Line type="monotone" dataKey={y} name={label} stroke={TEAL} strokeWidth={2} dot={{ r: 3 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** A funnel as proportional bars with counts and step-to-step rates. */
export function Funnel({ steps }: { steps: { name: string; n: number }[] }) {
  const max = Math.max(1, ...steps.map((s) => s.n));
  return (
    <div className="flex flex-col gap-2 p-4">
      {steps.map((s, i) => (
        <div key={s.name} className="grid grid-cols-[140px_1fr_90px] gap-3 items-center text-[13px] max-[560px]:grid-cols-[110px_1fr_70px]">
          <span className="text-muted">{s.name}</span>
          <div className="h-5 rounded bg-[#EEF0F2] overflow-hidden"><div className="h-full rounded bg-teal" style={{ width: `${(s.n / max) * 100}%` }} /></div>
          <span className="tnum text-right"><strong>{s.n.toLocaleString("en-IN")}</strong>{i > 0 && steps[i - 1].n ? <span className="text-muted text-[11.5px]"> · {Math.round((s.n / steps[i - 1].n) * 100)}%</span> : null}</span>
        </div>
      ))}
    </div>
  );
}
