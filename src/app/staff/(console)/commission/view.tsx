"use client";
import { useState } from "react";
import { PRODUCTS, rupees } from "@/staff/constants";
import { saveRates } from "../../actions";
import { Empty, Panel, btnPrimary, td, th, useRun } from "../ui";

const num = "w-[70px] text-right border border-input rounded-[7px] px-2 py-1.5 text-[13.5px] outline-none focus:border-teal";

export function CommissionView({ rates, target, people }: { rates: Record<string, { first: number; renew: number }>; target: number; people: { id: string; name: string; team: string; status: string; bonusPct: number }[] }) {
  const { run, busy } = useRun();
  const [r, setR] = useState(() => Object.fromEntries(Object.entries(rates).map(([k, v]) => [k, { first: String(v.first), renew: String(v.renew) }])));
  const [b, setB] = useState(() => Object.fromEntries(people.map((p) => [p.id, String(p.bonusPct)])));
  const [t, setT] = useState(target ? String(target / 100) : "");
  const clean = (v: string) => v.replace(/[^\d.]/g, "");
  const save = <button disabled={busy} onClick={() => run(() => saveRates(r, b, t))} className={btnPrimary}>Save rates</button>;
  return (
    <>
      <Panel title="Commission rates by product" sub="Percent of the price before GST. New rates apply to sales logged from now on; logged sales keep their rate." right={save}>
        <div className="overflow-auto"><table className="w-full border-collapse min-w-[640px] text-[13.5px]">
          <thead><tr className="bg-[#FAFBFB] text-muted text-[12px]"><th className={th}>Product</th><th className={th + " text-right"}>List price (incl. GST)</th><th className={th + " text-right"}>New sale %</th><th className={th + " text-right"}>Renewal %</th><th className={th + " text-right"}>Earns per new monthly sale</th></tr></thead>
          <tbody>{PRODUCTS.map((p) => (
            <tr key={p.id}>
              <td className={td + " font-semibold"}>{p.name}</td>
              <td className={td + " text-right"}>₹{p.m.toLocaleString("en-IN")}{"once" in p ? " once" : " / mo"}</td>
              <td className={td + " text-right"}><input aria-label={`${p.name} new sale percent`} className={num} inputMode="decimal" value={r[p.id]?.first ?? ""} onChange={(e) => setR((x) => ({ ...x, [p.id]: { ...x[p.id], first: clean(e.target.value) } }))} /> %</td>
              <td className={td + " text-right"}><input aria-label={`${p.name} renewal percent`} className={num} inputMode="decimal" value={r[p.id]?.renew ?? ""} onChange={(e) => setR((x) => ({ ...x, [p.id]: { ...x[p.id], renew: clean(e.target.value) } }))} /> %</td>
              <td className={td + " text-right font-semibold text-teal tnum"}>{rupees(Math.round((p.m * 10000) / 118 * (Number(r[p.id]?.first) || 0) / 100))}</td>
            </tr>
          ))}</tbody>
        </table></div>
      </Panel>
      <Panel title="Per-person bonus" sub="Extra percentage points on top of the product rate, for example for senior salespeople.">
        {people.length ? people.map((p) => (
          <div key={p.id} className="flex items-center gap-3 px-4 py-2.5 border-t border-[#F1F3F4] first:border-t-0 text-[13.5px] flex-wrap">
            <strong className="font-semibold min-w-[160px]">{p.name}</strong><span className="text-muted flex-1">{p.team || "—"} · {p.status}</span>
            <span className="flex items-center gap-1.5">+<input aria-label={`${p.name} bonus`} className={num + " w-16"} inputMode="decimal" value={b[p.id] ?? "0"} onChange={(e) => setB((x) => ({ ...x, [p.id]: clean(e.target.value) }))} />%</span>
          </div>
        )) : <Empty>No salespeople yet.</Empty>}
      </Panel>
      <Panel title="Monthly target" sub="Sales before GST each salesperson aims for in a month. Shown on their pipeline. Leave empty for none." right={save}>
        <div className="px-4 py-3 flex items-center gap-2 text-[13.5px]">₹<input aria-label="Monthly target per salesperson" className={num + " w-32"} inputMode="numeric" value={t} onChange={(e) => setT(e.target.value.replace(/\D/g, ""))} placeholder="60000" /> per salesperson</div>
      </Panel>
    </>
  );
}
