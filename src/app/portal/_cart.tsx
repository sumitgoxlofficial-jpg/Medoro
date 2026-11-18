"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useT } from "@/lib/i18n-client";
import { inr } from "@/lib/money";
import { placePortalOrderAction, quotePortalAction } from "./actions";

type Item = { medicineId: string; name: string; generic: string; pack: string; company: string; gstRate: number; rate: number; mrp: number | null; minOrderQty: number; stock: { label: string; tone: string }; schemes: string[] };
type Quote = { medicineId: string; qty: number; freeQty: number; rate: number; discPct: number; scheme: string | null; gstRate: number; problem: string | null; stock: { label: string } };
const TONE: Record<string, string> = { green: "text-[#1E7F4F]", amber: "text-[#94570A]", red: "text-[#B3261E]", gray: "text-[#5B6B82]" };
const newKey = () => "p" + Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => b.toString(16).padStart(2, "0")).join("");

/** Catalogue with distributor-specific rates and a cart. Repeat orders preload the cart from ?repeat. */
export function Shop({ code, items, preset }: { code: string; items: Item[]; preset: { medicineId: string; qty: number }[] }) {
  const t = useT();
  const router = useRouter();
  const storeKey = `medoro-cart-${code}`;
  const [cart, setCart] = useState<Record<string, number>>({});
  const [quote, setQuote] = useState<Quote[]>([]);
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [key, setKey] = useState(newKey);
  const [bulk, setBulk] = useState("");
  const [pending, start] = useTransition();
  useEffect(() => {
    let saved: Record<string, number> = {};
    try { saved = JSON.parse(localStorage.getItem(storeKey) ?? "{}"); } catch { /* storage unavailable */ }
    for (const p of preset) saved[p.medicineId] = p.qty;
    setCart(saved);
  }, [storeKey, preset]);
  useEffect(() => { try { localStorage.setItem(storeKey, JSON.stringify(cart)); } catch { /* ignore */ } }, [cart, storeKey]);
  const lines = useMemo(() => Object.entries(cart).filter(([, q]) => q > 0).map(([medicineId, qty]) => ({ medicineId, qty })), [cart]);
  useEffect(() => {
    if (!lines.length) { setQuote([]); return; }
    const h = setTimeout(async () => { const r = await quotePortalAction(code, lines); if (r.ok) setQuote(r.data as Quote[]); }, 250);
    return () => clearTimeout(h);
  }, [lines, code]);
  const total = quote.reduce((a, q) => { const tx = q.qty * q.rate * (1 - q.discPct / 100); return a + tx * (1 + q.gstRate / 100); }, 0);
  const setQty = (id: string, q: number) => setCart((c) => ({ ...c, [id]: Math.max(0, Math.floor(q) || 0) }));
  const addBulk = () => {
    // One line per product: "name or part of it, quantity" — matched against the catalogue.
    const next = { ...cart };
    const missed: string[] = [];
    for (const raw of bulk.split("\n").map((l) => l.trim()).filter(Boolean)) {
      const m = /^(.*?)[\s,;x×*]+(\d+)$/i.exec(raw);
      const name = (m ? m[1] : raw).toLowerCase(), qty = m ? Number(m[2]) : 1;
      const hit = items.find((i) => i.name.toLowerCase() === name) ?? items.find((i) => i.name.toLowerCase().includes(name));
      if (hit) next[hit.medicineId] = (next[hit.medicineId] ?? 0) + qty; else missed.push(raw);
    }
    setCart(next); setBulk("");
    setMsg(missed.length ? { ok: false, text: `${t("Not found")}: ${missed.join(", ")}` } : null);
  };
  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
      <div className="flex flex-col gap-2">
        {items.map((i) => (
          <div key={i.medicineId} className="bg-white border border-[#E3E7ED] rounded-xl px-4 py-3 flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-[200px]">
              <div className="font-semibold">{i.name} <span className="font-normal text-[#5B6B82] text-[13px]">{i.pack}</span></div>
              <div className="text-[12.5px] text-[#5B6B82]">{[i.company, i.generic !== i.name ? i.generic : ""].filter(Boolean).join(" · ")}</div>
              <div className="text-[12.5px] mt-0.5"><span className={TONE[i.stock.tone]}>{t(i.stock.label)}</span>{i.schemes.map((s) => <span key={s} className="ml-2 px-1.5 rounded bg-[#E6F4EC] text-[#1E7F4F] font-semibold">{s}</span>)}</div>
            </div>
            <div className="text-right text-[13px]"><div className="font-semibold tnum">{inr(i.rate)} <span className="font-normal text-[#5B6B82]">+ {i.gstRate}%</span></div>{i.mrp != null ? <div className="text-[#5B6B82]">MRP {inr(i.mrp)}</div> : null}</div>
            <div className="flex items-center gap-1">
              <button aria-label={t("Less")} onClick={() => setQty(i.medicineId, (cart[i.medicineId] ?? 0) - 1)} className="size-10 rounded-lg border border-[#C9D2DE] bg-white text-[18px]">−</button>
              <input aria-label={t("Quantity")} inputMode="numeric" value={cart[i.medicineId] ?? ""} placeholder="0" onChange={(e) => setQty(i.medicineId, Number(e.target.value))} className="h-10 w-[56px] text-center rounded-lg border border-[#C9D2DE] tnum" />
              <button aria-label={t("More")} onClick={() => setQty(i.medicineId, (cart[i.medicineId] ?? 0) + Math.max(1, i.minOrderQty))} className="size-10 rounded-lg bg-[#0B2545] text-white text-[18px]">+</button>
            </div>
          </div>
        ))}
        {!items.length ? <div className="bg-white border border-[#E3E7ED] rounded-xl p-8 text-center text-[#5B6B82]">{t("No products match.")}</div> : null}
      </div>
      <aside className="bg-white border border-[#E3E7ED] rounded-xl p-4 h-fit lg:sticky lg:top-4 flex flex-col gap-3">
        <h2 className="m-0 text-[15px] font-semibold">{t("Your order")}</h2>
        {quote.length ? (
          <ul className="list-none p-0 m-0 flex flex-col gap-1.5 text-[13px]">
            {quote.map((q) => { const i = items.find((x) => x.medicineId === q.medicineId); return (
              <li key={q.medicineId} className="flex gap-2"><span className="flex-1">{i?.name ?? "—"} × {q.qty}{q.freeQty ? <span className="text-[#1E7F4F]"> +{q.freeQty} {t("free")}</span> : null}{q.problem ? <span className="block text-[#B3261E]">{t(q.problem)}</span> : null}</span><span className="tnum">{inr(Math.round(q.qty * q.rate * (1 - q.discPct / 100)))}</span></li>
            ); })}
          </ul>
        ) : <div className="text-[13px] text-[#5B6B82]">{t("Add products with +.")}</div>}
        <div className="flex justify-between font-semibold border-t border-[#EEF1F5] pt-2"><span>{t("Approx. total incl. GST")}</span><span className="tnum">{inr(Math.round(total))}</span></div>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("Note for the distributor")} className="rounded-lg border border-[#C9D2DE] p-2 text-[14px] min-h-[56px]" />
        <button disabled={pending || !lines.length} onClick={() => start(async () => {
          const r = await placePortalOrderAction(code, lines, note, key);
          if (!r.ok) { setMsg({ ok: false, text: t(r.error) }); return; }
          setCart({}); setKey(newKey()); setNote(""); setMsg({ ok: true, text: t("Order placed.") }); router.push(`/portal/${code}/orders`);
        })} className="h-12 rounded-lg bg-[#0B2545] text-white font-semibold disabled:opacity-40">{pending ? t("Working…") : t("Place order")}</button>
        {msg ? <div role="status" className={`text-[13px] ${msg.ok ? "text-[#1E7F4F]" : "text-[#B3261E]"}`}>{msg.text}</div> : null}
        <details><summary className="cursor-pointer text-[13px] font-semibold">{t("Bulk order (paste a list)")}</summary>
          <textarea value={bulk} onChange={(e) => setBulk(e.target.value)} placeholder={"Dolo 650, 20\nAzithral 500 x 10"} className="w-full mt-2 rounded-lg border border-[#C9D2DE] p-2 text-[13px] min-h-[90px]" />
          <button onClick={addBulk} className="h-9 px-3 rounded-lg border border-[#C9D2DE] text-[13px] font-semibold">{t("Add to cart")}</button>
        </details>
        <p className="text-[11.5px] text-[#6B7A90] m-0">{t("Rates and schemes are your distributor’s for your account. The distributor confirms stock and credit when approving.")}</p>
      </aside>
    </div>
  );
}
