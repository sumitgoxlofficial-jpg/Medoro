"use client";
import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Ban, Hourglass } from "lucide-react";
import { Segmented } from "@/components/ui/segmented";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Empty } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";
import { inr0 } from "@/lib/money";
import { monthYear } from "@/lib/dates";
import type { expiryRows } from "@/domain/intelligence/service";
import { quarantineAction, returnAction, transferAction, writeOffAction } from "./actions";

type D = Awaited<ReturnType<typeof expiryRows>>;
const th = "text-left text-[12px] font-medium text-muted px-3.5 py-2.5 border-b border-[#E3E6E9] whitespace-nowrap";
const td = "px-3.5 py-2.5 border-b border-row align-top";

export function ExpiryView({ w, data, recovered, canAdjust, canPurchase }: { w: number; data: D; recovered: number; canAdjust: boolean; canPurchase: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [pending, start] = useTransition();
  const ask = (msg: string, def: number) => { const v = prompt(msg, String(def)); if (v === null) return null; const n = parseInt(v, 10); return n > 0 ? n : (toast("Enter a quantity.", "red"), null); };
  const done = (r: { ok: true; data: string } | { ok: false; error: string }, ok: (x: string) => string) => toast(r.ok ? ok(r.data) : r.error, r.ok ? "green" : "red");
  const rows = data.rows;
  const kpis = [
    ["Batches at risk", String(rows.filter((r) => r.unsold > 0).length)], ["Exposure at cost", inr0(rows.reduce((a, r) => a + r.exposure, 0))],
    ["Projected loss at cost", inr0(rows.reduce((a, r) => a + r.loss, 0))], ["Returned to suppliers (30 d)", inr0(recovered)],
  ];
  return (
    <div className="flex flex-col gap-3.5 max-w-[1400px]">
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-[13px] text-muted">Window</span>
        <Segmented value={String(w)} onChange={(v) => router.replace(`/app/expiry?w=${v}`)} className="bg-white border border-line" options={[30, 60, 90, 180].map((x) => ({ value: String(x), label: `${x} days` }))} />
        <span className="text-[12px] text-faint">Projections assume FEFO and the 28-day average sales rate. Expired stock is always blocked at POS.</span>
      </div>
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4">
        {kpis.map(([k, v]) => <div key={k} className="bg-white border border-line rounded-xl px-4 py-3 flex flex-col gap-1"><span className="text-[12.5px] text-muted">{k}</span><span className="text-[22px] font-semibold tnum">{v}</span></div>)}
      </div>
      <div className="bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] overflow-auto">
        {rows.length ? (
          <table className="w-full border-collapse min-w-[1050px] text-[13.5px]">
            <thead><tr className="bg-subtle"><th className={th}>Batch</th><th className={th}>Expiry</th><th className={th + " text-right"}>Qty</th><th className={th + " text-right"}>At cost</th><th className={th}>Sell-through projection</th><th className={th + " text-right"}>Projected loss</th><th className={th}>Recommendation</th><th className={th} /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className={td}><div className="font-semibold">{r.medicine}</div><div className="text-[12px] font-mono text-muted">{r.batchNo}{r.status !== "ok" ? ` · ${r.status}` : ""}</div></td>
                  <td className={td}><div className="flex flex-col"><span>{monthYear(r.expiry)}</span><Badge tone={r.days <= 30 ? "red" : r.days <= 60 ? "amber" : "gray"} className="self-start mt-0.5">{r.days} days</Badge></div></td>
                  <td className={td + " text-right tnum"}>{r.qtyText}</td>
                  <td className={td + " text-right tnum"}>{inr0(r.exposure)}</td>
                  <td className={td}><div>{r.unsold ? `${r.sold} sell, ${r.unsold} left at expiry` : "All sell before expiry"}</div><div className="text-[12px] text-faint">{r.velocity ? `${r.velocity.toFixed(1)}/day × ${r.days} d` : "No sales in 28 days"}</div></td>
                  <td className={td + " text-right tnum font-semibold"} style={{ color: r.loss ? "#B3261E" : "#1E7F4F" }}>{inr0(r.loss)}</td>
                  <td className={td + " text-[13px] max-w-[260px]"}>{r.rec.text}</td>
                  <td className={td + " whitespace-nowrap"}>
                    <div className="flex gap-1.5 justify-end">
                      {r.rec.kind === "return" && canPurchase ? <Button size="sm" variant="primary" disabled={pending} onClick={() => { const n = ask(`Return how many ${r.unitWord} of ${r.batchNo} to ${r.supplier}?`, r.unsold); if (n) start(async () => done(await returnAction(r.id, n, "Near expiry"), (x) => `${x} raised. Stock and payable reduced.`)); }}>Return</Button> : null}
                      {r.rec.kind === "transfer" && canAdjust ? <Button size="sm" variant="primary" disabled={pending} onClick={() => { const n = ask(`Transfer how many ${r.unitWord} of ${r.batchNo}?`, r.unsold); if (n) start(async () => done(await transferAction(r.id, r.rec.branchId!, n), (x) => `${x} requested. It is approved under Inventory → Transfers by someone other than you (or an owner).`)); }}>Transfer</Button> : null}
                      {canAdjust && r.status === "ok" ? <Button size="sm" disabled={pending} onClick={() => start(async () => { const x = await quarantineAction(r.id); toast(x.ok ? x.message! : x.error, x.ok ? "green" : "red"); })}>Quarantine</Button> : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : <Empty icon={Hourglass} title={`Nothing expires in the next ${w} days`} body="Batches show here as their expiry approaches, with a projection of what will sell in time." />}
      </div>
      {data.expired.length ? (
        <div className="bg-bad-bg/50 border border-[#F0C8C3] rounded-xl px-4 py-3 flex flex-col gap-1.5">
          <div className="font-semibold text-[14.5px] text-bad flex items-center gap-1.5"><Ban size={16} />Expired, blocked from sale</div>
          {data.expired.map((x) => (
            <div key={x.id} className="flex items-center gap-3 flex-wrap text-[13.5px] py-1 border-b border-[#F3D9D5] last:border-0">
              <strong>{x.medicine}</strong><span className="font-mono text-[12.5px]">{x.batchNo}</span><span className="text-muted">expired {monthYear(x.expiry)} · {x.qtyText} · {inr0(x.exposure)} at cost</span>
              <div className="ml-auto flex gap-1.5">
                {x.supplier && canPurchase ? <Button size="sm" disabled={pending} onClick={() => { const n = ask(`Return how many ${x.unitWord} to ${x.supplier}?`, x.qty); if (n) start(async () => done(await returnAction(x.id, n, "Expired"), (v) => `${v} raised.`)); }}>Return to supplier</Button> : null}
                {canAdjust ? <Button size="sm" variant="danger-outline" disabled={pending} onClick={() => { const n = ask(`Write off how many ${x.unitWord} of ${x.batchNo}?`, x.qty); if (n) start(async () => done(await writeOffAction(x.id, n, "Expired"), (v) => `${v} posted to Stock loss.`)); }}>Write off</Button> : null}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
