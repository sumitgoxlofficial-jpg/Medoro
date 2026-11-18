"use client";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n-client";
import { inr } from "@/lib/money";
import { Btn } from "./forms";
import { createPoAction, grnAction } from "../actions";

type Product = { id: string; name: string; pack: string; mrp: number; pts: number; gstRate: number };
type Po = { id: string; no: string; supplierId: string; items: { id: string; medicineId: string; qty: number; received: number; rate: number; mrp: number | null; freeQty: number }[] };
type Line = { medicineId: string; batchNo: string; expiry: string; qty: string; freeQty: string; rate: string; mrp: string; tradePct: string; cashPct: string; poItemId: string | null };

const blank = (): Line => ({ medicineId: "", batchNo: "", expiry: "", qty: "", freeQty: "", rate: "", mrp: "", tradePct: "", cashPct: "", poItemId: null });
const r2 = (p: number) => (p / 100).toFixed(2);

/** Purchase order (mode "po") or goods receipt against a supplier invoice (mode "grn"): batches, expiry, free goods, discounts. */
export function PurchaseEntry({ mode, suppliers, products, pos = [] }: { mode: "po" | "grn"; suppliers: { id: string; name: string }[]; products: Product[]; pos?: Po[] }) {
  const t = useT();
  const router = useRouter();
  const [supplierId, setSupplier] = useState("");
  const [poId, setPo] = useState("");
  const [inv, setInv] = useState({ no: "", date: new Date().toISOString().slice(0, 10), total: "" });
  const [lines, setLines] = useState<Line[]>([blank()]);
  const [short, setShort] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, start] = useTransition();
  const set = (i: number, p: Partial<Line>) => setLines((ls) => ls.map((l, k) => (k === i ? { ...l, ...p } : l)));
  const pick = (i: number, id: string) => { const p = products.find((x) => x.id === id); set(i, { medicineId: id, mrp: p ? r2(p.mrp) : "", rate: p?.pts ? r2(p.pts) : "" }); };
  const loadPo = (id: string) => {
    setPo(id);
    const po = pos.find((p) => p.id === id);
    if (!po) return;
    setSupplier(po.supplierId);
    setLines(po.items.filter((x) => x.qty > x.received).map((x) => ({ ...blank(), medicineId: x.medicineId, qty: String(x.qty - x.received), rate: r2(x.rate), mrp: x.mrp ? r2(x.mrp) : r2(products.find((p) => p.id === x.medicineId)?.mrp ?? 0), poItemId: x.id })));
  };
  const total = useMemo(() => lines.reduce((a, l) => {
    const p = products.find((x) => x.id === l.medicineId); const q = Number(l.qty) || 0, r = Math.round((Number(l.rate) || 0) * 100);
    const net = q * r * (1 - (Number(l.tradePct) || 0) / 100) * (1 - (Number(l.cashPct) || 0) / 100);
    return a + net * (1 + (p?.gstRate ?? 0) / 100);
  }, 0), [lines, products]);
  const save = () => start(async () => {
    const ls = lines.filter((l) => l.medicineId);
    const r = mode === "po"
      ? await createPoAction({ supplierId, lines: ls.map((l) => ({ medicineId: l.medicineId, qty: l.qty, rate: l.rate, freeQty: l.freeQty || 0, mrp: l.mrp || null, tradePct: l.tradePct || 0, cashPct: l.cashPct || 0 })) })
      : await grnAction({ supplierId, invoiceNo: inv.no, invoiceDate: inv.date, statedTotal: inv.total, poId: poId || null, acceptShortExpiry: short, lines: ls.map((l) => ({ medicineId: l.medicineId, batchNo: l.batchNo, expiry: l.expiry, qty: l.qty, freeQty: l.freeQty || 0, rate: l.rate, mrp: l.mrp, tradePct: l.tradePct || 0, cashPct: l.cashPct || 0, poItemId: l.poItemId })) });
    if (!r.ok) { setMsg({ ok: false, text: t(r.error) }); return; }
    setMsg({ ok: true, text: t(r.message ?? "Saved.") }); setLines([blank()]); setInv({ no: "", date: inv.date, total: "" }); setPo(""); router.refresh();
  });
  const cell = "h-8 rounded border border-input px-1.5 text-[12.5px] w-full";
  return (
    <div className="flex flex-col gap-3">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {mode === "grn" && pos.length ? <label className="flex flex-col gap-1 text-[12px] font-medium text-muted">{t("Against PO")}<select aria-label={t("Against PO")} value={poId} onChange={(e) => loadPo(e.target.value)} className={cell + " h-9"}><option value="">{t("— none —")}</option>{pos.map((p) => <option key={p.id} value={p.id}>{p.no}</option>)}</select></label> : null}
        <label className="flex flex-col gap-1 text-[12px] font-medium text-muted">{t("Supplier")}<select aria-label={t("Supplier")} value={supplierId} onChange={(e) => setSupplier(e.target.value)} className={cell + " h-9"}><option value="">{t("Choose…")}</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
        {mode === "grn" ? <>
          <label className="flex flex-col gap-1 text-[12px] font-medium text-muted">{t("Supplier invoice no.")}<input aria-label={t("Supplier invoice no.")} value={inv.no} onChange={(e) => setInv({ ...inv, no: e.target.value })} className={cell + " h-9"} /></label>
          <label className="flex flex-col gap-1 text-[12px] font-medium text-muted">{t("Invoice date")}<input aria-label={t("Invoice date")} type="date" value={inv.date} onChange={(e) => setInv({ ...inv, date: e.target.value })} className={cell + " h-9"} /></label>
          <label className="flex flex-col gap-1 text-[12px] font-medium text-muted">{t("Printed total ₹")}<input aria-label={t("Printed total ₹")} inputMode="decimal" value={inv.total} onChange={(e) => setInv({ ...inv, total: e.target.value })} className={cell + " h-9"} /></label>
        </> : null}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[12.5px] min-w-[900px]">
          <thead><tr className="text-[11px] uppercase text-muted text-left"><th className="py-1 w-[26%]">{t("Product")}</th>{mode === "grn" ? <><th>{t("Batch")}</th><th>{t("Expiry")}</th></> : null}<th>{t("Qty")}</th><th>{t("Free")}</th><th>{t("Rate ₹")}</th><th>{t("MRP ₹")}</th><th>{t("Trade %")}</th><th>{t("Cash %")}</th><th /></tr></thead>
          <tbody>{lines.map((l, i) => (
            <tr key={i}>
              <td className="py-1 pr-1"><select aria-label={t("Product")} value={l.medicineId} onChange={(e) => pick(i, e.target.value)} className={cell}><option value="">{t("Choose…")}</option>{products.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.pack}</option>)}</select></td>
              {mode === "grn" ? <><td className="pr-1"><input aria-label={t("Batch")} value={l.batchNo} onChange={(e) => set(i, { batchNo: e.target.value.toUpperCase() })} className={cell} /></td><td className="pr-1"><input aria-label={t("Expiry")} type="month" value={l.expiry.slice(0, 7)} onChange={(e) => set(i, { expiry: e.target.value })} className={cell} /></td></> : null}
              <td className="pr-1"><input aria-label={t("Qty")} inputMode="numeric" value={l.qty} onChange={(e) => set(i, { qty: e.target.value })} className={cell} /></td>
              <td className="pr-1"><input aria-label={t("Free")} inputMode="numeric" value={l.freeQty} onChange={(e) => set(i, { freeQty: e.target.value })} className={cell} /></td>
              <td className="pr-1"><input aria-label={t("Rate ₹")} inputMode="decimal" value={l.rate} onChange={(e) => set(i, { rate: e.target.value })} className={cell} /></td>
              <td className="pr-1"><input aria-label={t("MRP ₹")} inputMode="decimal" value={l.mrp} onChange={(e) => set(i, { mrp: e.target.value })} className={cell} /></td>
              <td className="pr-1"><input aria-label={t("Trade %")} inputMode="decimal" value={l.tradePct} onChange={(e) => set(i, { tradePct: e.target.value })} className={cell} /></td>
              <td className="pr-1"><input aria-label={t("Cash %")} inputMode="decimal" value={l.cashPct} onChange={(e) => set(i, { cashPct: e.target.value })} className={cell} /></td>
              <td><button aria-label={t("Remove")} onClick={() => setLines((ls) => ls.filter((_, k) => k !== i))} className="px-2 text-[#B3261E]">✕</button></td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <Btn onClick={() => setLines((ls) => [...ls, blank()])}>{t("+ Line")}</Btn>
        <span className="text-[13px]">{t("Approx. value incl. GST")}: <strong className="tnum">{inr(Math.round(total))}</strong></span>
        {mode === "grn" ? <label className="flex items-center gap-1.5 text-[12.5px]"><input type="checkbox" checked={short} onChange={(e) => setShort(e.target.checked)} />{t("I accept short-dated stock")}</label> : null}
        <Btn variant="primary" disabled={pending} onClick={save}>{pending ? t("Working…") : mode === "po" ? t("Save draft PO") : t("Post GRN")}</Btn>
        {msg ? <span role="status" className={`text-[12.5px] ${msg.ok ? "text-[#1E7F4F]" : "text-[#B3261E]"}`}>{msg.text}</span> : null}
      </div>
    </div>
  );
}
