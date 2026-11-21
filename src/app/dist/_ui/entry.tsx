"use client";
import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n-client";
import { inr } from "@/lib/money";
import { invoiceTotals } from "@/domain/distribution/rules/pricing";
import { Btn } from "./forms";
import { searchProductsAction, quoteAction, placeOrderAction, directInvoiceAction } from "../actions";
import { useOnChange } from "@/lib/react-state";

type Chemist = { id: string; name: string; status: string; dlExpiry: string | null; stateCode: string | null; balance?: number; limit: number };
type Hit = { id: string; name: string; pack: string; company: string; ptr: number; mrp: number; gstRate: number; stockUnits: number; packSize: number; distReady: boolean; discontinued: boolean };
type Line = { medicineId: string; name: string; pack: string; qty: number; rate: number; discPct: number; freeQty: number; scheme: string | null; gstRate: number; available: number; problem: string | null; rateOverride?: string };

const newKey = () => "k" + Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");

/**
 * Order booking and counter billing. Type to search (↑/↓, Enter adds), quantity, Enter again for the next product.
 * Rates, schemes and stock come from the server for the chosen chemist; the server re-checks everything on save.
 */
export function LineEntry({ chemists, mode, ownState, canOverride, initialChemist }: { chemists: Chemist[]; mode: "order" | "bill"; ownState: string; canOverride?: boolean; initialChemist?: string }) {
  const t = useT();
  const router = useRouter();
  const [customerId, setCustomer] = useState(initialChemist ?? "");
  const [chemQ, setChemQ] = useState("");
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [hi, setHi] = useState(0);
  const [lines, setLines] = useState<Line[]>([]);
  const [note, setNote] = useState("");
  const [override, setOverride] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [key, setKey] = useState(newKey);
  const [pending, start] = useTransition();
  const search = useRef<HTMLInputElement>(null);
  const qtyRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const chem = chemists.find((c) => c.id === customerId);

  useOnChange([q.trim().length < 2], () => { if (q.trim().length < 2) setHits([]); });
  useEffect(() => {
    if (q.trim().length < 2) return;
    const h = setTimeout(async () => { const r = await searchProductsAction(q); if (r.ok) { setHits((r.data as Hit[]).filter((x) => x.distReady && !x.discontinued)); setHi(0); } }, 180);
    return () => clearTimeout(h);
  }, [q]);

  // Re-price whenever the chemist or quantities change (schemes depend on quantity).
  const sig = lines.map((l) => `${l.medicineId}:${l.qty}`).join(",");
  useEffect(() => {
    if (!customerId || !lines.length) return;
    const h = setTimeout(async () => {
      const r = await quoteAction(customerId, lines.map((l) => ({ medicineId: l.medicineId, qty: l.qty })));
      if (!r.ok) { setMsg({ ok: false, text: t(r.error) }); return; }
      const q = r.data as Line[];
      setLines((cur) => cur.map((l) => { const x = q.find((y) => y.medicineId === l.medicineId); return x ? { ...l, rate: x.rate, discPct: x.discPct, freeQty: x.freeQty, scheme: x.scheme, gstRate: x.gstRate, available: x.available, problem: x.problem } : l; }));
    }, 250);
    return () => clearTimeout(h);
  }, [customerId, sig]); // eslint-disable-line react-hooks/exhaustive-deps

  const add = (h: Hit) => {
    setQ(""); setHits([]);
    if (lines.some((l) => l.medicineId === h.id)) { qtyRefs.current[h.id]?.focus(); return; }
    setLines((cur) => [...cur, { medicineId: h.id, name: h.name, pack: h.pack, qty: 1, rate: h.ptr, discPct: 0, freeQty: 0, scheme: null, gstRate: h.gstRate, available: Math.floor(h.stockUnits / Math.max(1, h.packSize)), problem: null }]);
    setTimeout(() => qtyRefs.current[h.id]?.select(), 30);
  };

  const inter = !!(chem?.stateCode && ownState && chem.stateCode !== ownState);
  const totals = useMemo(() => {
    const ok = lines.filter((l) => l.qty > 0);
    if (!ok.length) return null;
    try { return invoiceTotals(ok.map((l) => ({ qty: l.qty, rate: l.rateOverride ? Math.round(Number(l.rateOverride) * 100) || l.rate : l.rate, gstRate: l.gstRate, discPct: l.discPct })), inter); } catch { return null; }
  }, [lines, inter]);

  const submit = () => {
    if (!customerId) { setMsg({ ok: false, text: t("Choose the chemist.") }); return; }
    if (!lines.length) { setMsg({ ok: false, text: t("Add at least one product.") }); return; }
    start(async () => {
      const r = mode === "order"
        ? await placeOrderAction({ customerId, idempotencyKey: key, note, source: "office", lines: lines.map((l) => ({ medicineId: l.medicineId, qty: l.qty })) })
        : await directInvoiceAction({ customerId, idempotencyKey: key, overrideReason: override, lines: lines.map((l) => ({ medicineId: l.medicineId, qty: l.qty, ...(l.rateOverride ? { rate: l.rateOverride } : {}) })) });
      if (!r.ok) { setMsg({ ok: false, text: t(r.error) }); return; }
      setMsg({ ok: true, text: t(r.message ?? "Saved.") });
      setLines([]); setKey(newKey()); setNote(""); setOverride("");
      const d = r.data as { orderId?: string; invoiceId?: string };
      router.push(d.invoiceId ? `/dist/invoices/${d.invoiceId}` : `/dist/orders/${d.orderId}`);
    });
  };

  const filteredChem = chemists.filter((c) => !chemQ || c.name.toLowerCase().includes(chemQ.toLowerCase())).slice(0, 50);
  return (
    <div className="grid gap-4 xl:grid-cols-[1fr_320px]">
      <div className="bg-white border border-line rounded-[10px]">
        <div className="p-4 border-b border-line-soft grid gap-3 md:grid-cols-[1fr_1fr]">
          <label className="flex flex-col gap-1 text-[12px] font-medium text-muted">{t("Chemist")}
            <div className="flex gap-2">
              <input aria-label={t("Filter chemists")} value={chemQ} onChange={(e) => setChemQ(e.target.value)} placeholder={t("Filter")} className="h-9 w-[110px] rounded-md border border-input px-2 text-[13px]" />
              <select aria-label={t("Chemist")} value={customerId} onChange={(e) => setCustomer(e.target.value)} className="h-9 flex-1 min-w-0 rounded-md border border-input px-2 text-[13.5px]" autoFocus>
                <option value="">{t("Choose chemist…")}</option>
                {filteredChem.map((c) => <option key={c.id} value={c.id}>{c.name}{c.status !== "active" ? ` (${c.status})` : ""}</option>)}
              </select>
            </div>
          </label>
          <label className="flex flex-col gap-1 text-[12px] font-medium text-muted relative">{t("Add product")}
            <input aria-label={t("Add product")} ref={search} data-search value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Type 2+ letters, ↑ ↓ Enter")} className="h-9 rounded-md border border-input px-2 text-[13.5px]"
              onKeyDown={(e) => {
                if (e.key === "ArrowDown") { e.preventDefault(); setHi((h) => Math.min(h + 1, hits.length - 1)); }
                if (e.key === "ArrowUp") { e.preventDefault(); setHi((h) => Math.max(h - 1, 0)); }
                if (e.key === "Enter" && hits[hi]) { e.preventDefault(); add(hits[hi]); }
                if (e.key === "Escape") setHits([]);
              }} />
            {hits.length ? (
              <ul role="listbox" className="absolute top-full mt-1 left-0 right-0 z-10 bg-white border border-input rounded-md shadow-lg max-h-[300px] overflow-y-auto list-none m-0 p-0">
                {hits.map((h, i) => (
                  <li key={h.id} role="option" aria-selected={i === hi} onMouseDown={(e) => { e.preventDefault(); add(h); }} className={`px-3 py-2 cursor-pointer text-[13px] flex gap-3 ${i === hi ? "bg-teal-tint" : ""}`}>
                    <span className="flex-1"><span className="font-medium text-teal">{h.name}</span> <span className="text-muted">{h.pack} · {h.company}</span></span>
                    <span className="tnum text-muted">{inr(h.ptr)}</span>
                    <span className={`tnum w-[70px] text-right ${h.stockUnits > 0 ? "text-[#1E7F4F]" : "text-[#B3261E]"}`}>{Math.floor(h.stockUnits / Math.max(1, h.packSize))} {t("packs")}</span>
                  </li>
                ))}
              </ul>
            ) : null}
          </label>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-[13px] border-collapse">
            <thead><tr className="bg-subtle text-[11.5px] uppercase tracking-[0.04em] text-muted">
              <th className="text-left px-3 py-2">{t("Product")}</th><th className="px-2 py-2 text-right">{t("Qty")}</th><th className="px-2 py-2 text-right">{t("Free")}</th><th className="px-2 py-2 text-right">{t("Rate")}</th><th className="px-2 py-2 text-right">{t("Disc %")}</th><th className="px-2 py-2 text-right">{t("GST")}</th><th className="px-2 py-2 text-right">{t("Stock")}</th><th />
            </tr></thead>
            <tbody>
              {lines.map((l) => (
                <tr key={l.medicineId} className="border-b border-line-soft">
                  <td className="px-3 py-2"><div className="font-medium">{l.name}</div><div className="text-[12px] text-muted">{l.pack}{l.scheme ? <span className="ml-2 text-[#1E7F4F] font-semibold">{t("Scheme")} {l.scheme}</span> : null}{l.problem ? <span className="ml-2 text-[#B3261E]">{t(l.problem)}</span> : null}</div></td>
                  <td className="px-2 py-2 text-right"><input aria-label={`${t("Qty")} ${l.name}`} ref={(el) => { qtyRefs.current[l.medicineId] = el; }} type="number" min={1} value={l.qty} onChange={(e) => setLines((c) => c.map((x) => (x.medicineId === l.medicineId ? { ...x, qty: Math.max(0, Math.floor(Number(e.target.value) || 0)) } : x)))} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); search.current?.focus(); } }} className="h-8 w-[70px] text-right rounded border border-input px-1.5 tnum" /></td>
                  <td className="px-2 py-2 text-right tnum text-[#1E7F4F]">{l.freeQty || ""}</td>
                  <td className="px-2 py-2 text-right tnum">{mode === "bill" && canOverride ? <input aria-label={t("Rate")} placeholder={(l.rate / 100).toFixed(2)} value={l.rateOverride ?? ""} onChange={(e) => setLines((c) => c.map((x) => (x.medicineId === l.medicineId ? { ...x, rateOverride: e.target.value } : x)))} className="h-8 w-[80px] text-right rounded border border-input px-1.5" /> : inr(l.rate)}</td>
                  <td className="px-2 py-2 text-right tnum">{l.discPct ? l.discPct : ""}</td>
                  <td className="px-2 py-2 text-right tnum">{l.gstRate}%</td>
                  <td className={`px-2 py-2 text-right tnum ${l.available < l.qty + l.freeQty ? "text-[#B3261E] font-semibold" : "text-muted"}`}>{l.available}</td>
                  <td className="px-2"><button aria-label={t("Remove")} onClick={() => setLines((c) => c.filter((x) => x.medicineId !== l.medicineId))} className="text-[#B3261E] px-2">✕</button></td>
                </tr>
              ))}
              {!lines.length ? <tr><td colSpan={8} className="px-3 py-10 text-center text-muted">{t("Search a product above and press Enter to add it.")}</td></tr> : null}
            </tbody>
          </table>
        </div>
      </div>
      <aside className="bg-white border border-line rounded-[10px] p-4 flex flex-col gap-3 h-fit xl:sticky xl:top-20">
        {chem ? (
          <div className="text-[12.5px] text-muted flex flex-col gap-0.5">
            <div className="text-[14px] font-semibold text-teal">{chem.name}</div>
            <div>{t("Credit limit")}: {inr(chem.limit)}{chem.balance != null ? ` · ${t("Balance")}: ${inr(chem.balance)}` : ""}</div>
            {chem.dlExpiry ? <div className={chem.dlExpiry < new Date().toISOString().slice(0, 10) ? "text-[#B3261E] font-semibold" : ""}>{t("Licence valid to")} {chem.dlExpiry}</div> : null}
            {inter ? <div className="text-[#2459C9]">{t("Inter-state: IGST")}</div> : null}
          </div>
        ) : <div className="text-[13px] text-muted">{t("Choose the chemist to see their rates, schemes and credit.")}</div>}
        <dl className="grid grid-cols-2 gap-y-1 text-[13px] m-0 border-t border-line-soft pt-3">
          <dt className="text-muted">{t("Taxable")}</dt><dd className="m-0 text-right tnum">{inr(totals?.taxable ?? 0)}</dd>
          <dt className="text-muted">{t("Discount")}</dt><dd className="m-0 text-right tnum">{inr(totals?.disc ?? 0)}</dd>
          <dt className="text-muted">{inter ? "IGST" : "CGST + SGST"}</dt><dd className="m-0 text-right tnum">{inr(totals?.tax ?? 0)}</dd>
          <dt className="text-muted">{t("Round off")}</dt><dd className="m-0 text-right tnum">{inr(totals?.roundOff ?? 0)}</dd>
          <dt className="font-semibold text-[15px]">{t("Total")}</dt><dd className="m-0 text-right tnum font-semibold text-[15px]">{inr(totals?.total ?? 0)}</dd>
        </dl>
        {mode === "order" ? <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("Note for the warehouse (optional)")} className="rounded-md border border-input p-2 text-[13px] min-h-[60px]" /> : null}
        {mode === "bill" && canOverride ? <input value={override} onChange={(e) => setOverride(e.target.value)} placeholder={t("Credit override reason (only if held)")} className="h-9 rounded-md border border-input px-2 text-[13px]" /> : null}
        <Btn variant="primary" onClick={submit} disabled={pending}>{pending ? t("Working…") : mode === "order" ? t("Place order") : t("Raise invoice")}</Btn>
        {msg ? <div role="status" className={`text-[12.5px] ${msg.ok ? "text-[#1E7F4F]" : "text-[#B3261E]"}`}>{msg.text}</div> : null}
        <p className="text-[11.5px] text-faint m-0">{mode === "bill" ? t("Stock is taken batch-wise, earliest expiry first. Credit limit, overdue bills and licence validity are checked on save.") : t("The order waits for approval; stock is reserved when it is approved.")}</p>
      </aside>
    </div>
  );
}
