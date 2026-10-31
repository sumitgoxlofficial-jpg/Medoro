"use client";
import { useState } from "react";
import { PRODUCTS } from "@/staff/constants";
import { createCoupon, setCouponActive } from "../../actions";
import { Empty, Panel, Pill, btn, btnPrimary, fieldCls, fmtDay, lbl, td, th, useRun } from "../ui";

type C = { id: string; code: string; percentOff: number; payPaise: number | null; plans: string[]; maxUses: number | null; uses: number; expiresAt: string | null; active: boolean; note: string | null; createdBy: string; createdAt: string };
const PLANS = PRODUCTS.filter((p) => !("addon" in p) && !("once" in p));
const planName = (id: string) => PLANS.find((p) => p.id === id)?.name ?? id;

function state(c: C): [string, string, string] {
  if (!c.active) return ["Off", "#F1F3F4", "#5B636B"];
  if (c.expiresAt && Date.parse(c.expiresAt) < Date.now()) return ["Expired", "#FDF2E1", "#94570A"];
  if (c.maxUses !== null && c.uses >= c.maxUses) return ["Used up", "#FDF2E1", "#94570A"];
  return ["Active", "#E7F6EE", "#18794E"];
}

export function CouponsView({ coupons }: { coupons: C[] }) {
  const { run, busy } = useRun();
  const blank = { code: "", percentOff: "20", payRupees: "", plans: [] as string[], maxUses: "", expiresOn: "", note: "" };
  const [f, setF] = useState(blank);
  const togglePlan = (id: string) => setF((x) => ({ ...x, plans: x.plans.includes(id) ? x.plans.filter((p) => p !== id) : [...x.plans, id] }));

  return (
    <>
      <Panel title="New coupon" sub="A percentage off the plan price, or a fixed price (GST included). Pharmacies type the code on their Subscription page before paying.">
        <form onSubmit={(e) => { e.preventDefault(); run(() => createCoupon(f as never), () => setF(blank)); }} className="px-4 py-4 flex flex-col gap-3">
          <div className="grid gap-3 grid-cols-[repeat(auto-fit,minmax(180px,1fr))]">
            <label className={lbl}>Code<input className={fieldCls + " font-mono uppercase"} value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase().replace(/[^A-Z0-9-]/g, "").slice(0, 20) })} placeholder="LAUNCH20" required /></label>
            <label className={lbl}>Percent off<input className={fieldCls} type="number" min={0} max={100} value={f.percentOff} onChange={(e) => setF({ ...f, percentOff: e.target.value })} disabled={!!f.payRupees} /></label>
            <label className={lbl}>Or fixed price, ₹ (e.g. 1 to test)<input className={fieldCls} type="number" min={1} step="0.01" value={f.payRupees} onChange={(e) => setF({ ...f, payRupees: e.target.value })} placeholder="Blank = use percent" /></label>
            <label className={lbl}>Max uses (blank = unlimited)<input className={fieldCls} type="number" min={1} value={f.maxUses} onChange={(e) => setF({ ...f, maxUses: e.target.value })} /></label>
            <label className={lbl}>Valid until (blank = no end)<input className={fieldCls} type="date" value={f.expiresOn} onChange={(e) => setF({ ...f, expiresOn: e.target.value })} /></label>
          </div>
          <div className="flex flex-col gap-1.5 text-[12.5px] text-muted">Plans (none ticked = every plan)
            <div className="flex gap-4 flex-wrap text-[13.5px] text-ink">{PLANS.map((p) => <label key={p.id} className="flex gap-1.5 items-center"><input type="checkbox" checked={f.plans.includes(p.id)} onChange={() => togglePlan(p.id)} />{p.name}</label>)}</div>
          </div>
          <label className={lbl}>Note (only staff see it)<input className={fieldCls} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} maxLength={200} placeholder="Diwali offer" /></label>
          <div className="flex justify-end"><button disabled={busy || !f.code} className={btnPrimary}>Create coupon</button></div>
        </form>
      </Panel>

      <Panel title="Coupons" sub="A coupon counts as used when a payment with it goes through.">
        {coupons.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-[13.5px] border-collapse">
              <thead className="text-[12px] text-muted bg-[#FAFBFB]"><tr><th className={th}>Code</th><th className={th}>Off</th><th className={th}>Plans</th><th className={th}>Used</th><th className={th}>Valid until</th><th className={th}>Status</th><th className={th} /></tr></thead>
              <tbody>{coupons.map((c) => {
                const [label, bg, fg] = state(c);
                return (
                  <tr key={c.id}>
                    <td className={td}><span className="font-mono font-semibold">{c.code}</span>{c.note ? <div className="text-[12px] text-muted">{c.note}</div> : null}</td>
                    <td className={td + " tnum"}>{c.payPaise !== null ? `Pay ₹${(c.payPaise / 100).toLocaleString("en-IN")}` : `${c.percentOff}%`}</td>
                    <td className={td}>{c.plans.length ? c.plans.map(planName).join(", ") : "All plans"}</td>
                    <td className={td + " tnum"}>{c.uses}{c.maxUses !== null ? ` / ${c.maxUses}` : ""}</td>
                    <td className={td}>{c.expiresAt ? fmtDay(c.expiresAt) : "No end"}</td>
                    <td className={td}><Pill bg={bg} fg={fg}>{label}</Pill></td>
                    <td className={td + " text-right"}><button disabled={busy} className={btn} onClick={() => run(() => setCouponActive(c.id, !c.active))}>{c.active ? "Switch off" : "Switch on"}</button></td>
                  </tr>
                );
              })}</tbody>
            </table>
          </div>
        ) : <Empty>No coupons yet. Create one above.</Empty>}
      </Panel>
    </>
  );
}
