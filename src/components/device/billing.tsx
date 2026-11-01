"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Minus, Plus, Trash2, Receipt, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { deviceDb } from "@/drivedb/device";
import { inr } from "@/lib/money";
import { card, input, errText, type Cfg, type Who } from "./ui";

type Med = { id: string; name: string; generic: string; mrpPaise: number; packSize: number; packUnit: string; looseUnit: string; allowLoose: number; schedule: string | null; stock: number };
type Line = { med: Med; qty: number; unit: "pack" | "loose" };
type Cust = { id: string; name: string; phone: string | null; balancePaise: number; creditLimitPaise: number };
const H1 = ["H1", "X", "NDPS"];
const price = (l: Line) => (l.unit === "loose" && l.med.packSize > 1 ? Math.floor(l.med.mrpPaise / l.med.packSize) : l.med.mrpPaise);
const stockText = (m: Med) => (m.packSize > 1 ? `${Math.floor(m.stock / m.packSize)} ${m.packUnit}s${m.stock % m.packSize ? ` + ${m.stock % m.packSize}` : ""}` : `${m.stock}`);

/** The counter: search, cart, customer, payment, complete. Calls onBill with the new bill's id. */
export function Billing({ cfg, who, onBill, side }: { cfg: Cfg; who: Who; onBill: (saleId: string) => void; side?: React.ReactNode }) {
  const toast = useToast();
  const dev = useRef(deviceDb()).current;
  const [q, setQ] = useState("");
  const [meds, setMeds] = useState<Med[]>([]);
  const [cart, setCart] = useState<Line[]>([]);
  const [custQ, setCustQ] = useState("");
  const [custs, setCusts] = useState<Cust[]>([]);
  const [cust, setCust] = useState<Cust | null>(null);
  const [disc, setDisc] = useState(0);
  const [mode, setMode] = useState<"cash" | "upi" | "card" | "credit">("cash");
  const [rx, setRx] = useState({ prescriber: "", prescriberReg: "", patientName: "" });
  const [busy, setBusy] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const cap = Math.min(who.discCap, cfg.maxDiscountPct);

  const search = useCallback((text: string) => dev.call("search", text, cfg.branchId).then((r) => setMeds(r as Med[])), [dev, cfg.branchId]);
  useEffect(() => { const t = setTimeout(() => search(q), 120); return () => clearTimeout(t); }, [q, search]);
  useEffect(() => {
    if (custQ.trim().length < 2) { setCusts([]); return; }
    const t = setTimeout(() => dev.call("findCustomers", custQ).then((r) => setCusts(r as Cust[])), 150);
    return () => clearTimeout(t);
  }, [custQ, dev]);

  const add = (m: Med) => {
    setCart((c) => {
      const i = c.findIndex((l) => l.med.id === m.id && l.unit === "pack");
      return i < 0 ? [...c, { med: m, qty: 1, unit: "pack" }] : c.map((l, j) => (j === i ? { ...l, qty: l.qty + 1 } : l));
    });
    setQ(""); searchRef.current?.focus();
  };
  const setLine = (i: number, patch: Partial<Line>) => setCart((c) => c.map((l, j) => (j === i ? { ...l, ...patch } : l)).filter((l) => l.qty > 0));
  const subtotal = cart.reduce((n, l) => n + price(l) * l.qty, 0);
  const estTotal = Math.round((subtotal - Math.round((subtotal * disc) / 100)) / 100) * 100;
  const needRx = cart.some((l) => l.med.schedule), needH1 = cart.some((l) => H1.includes(l.med.schedule ?? ""));

  const complete = useCallback(async () => {
    if (!cart.length || busy) return;
    setBusy(true);
    const t0 = performance.now();
    try {
      const r = await dev.call("createSale", {
        branchId: cfg.branchId, series: cfg.series, userId: who.userId, customerId: cust?.id ?? null, discountPct: disc, maxDiscountPct: cap,
        lines: cart.map((l) => ({ medicineId: l.med.id, qty: l.qty, unit: l.unit })), pay: { mode },
        prescriber: rx.prescriber || undefined, prescriberReg: rx.prescriberReg || undefined, patientName: rx.patientName || undefined,
      });
      toast(`Bill ${r.invoiceNo} · ${inr(r.totalPaise)} saved on this device (${Math.round(performance.now() - t0)} ms).`, "green");
      setCart([]); setCust(null); setCustQ(""); setDisc(0); setMode("cash"); setRx({ prescriber: "", prescriberReg: "", patientName: "" });
      void search("");
      onBill(r.saleId);
      searchRef.current?.focus();
    } catch (e) { toast(errText(e) || "The bill wasn’t saved.", "red"); }
    setBusy(false);
  }, [cart, busy, dev, cfg, who.userId, cust, disc, cap, mode, rx, toast, search, onBill]);

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "F2") { e.preventDefault(); searchRef.current?.focus(); }
      if (e.key === "F9") { e.preventDefault(); void complete(); }
    };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [complete]);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_380px]">
      <div className={card}>
        <div className="relative">
          <Search size={16} className="absolute left-3 top-2.5 text-muted" />
          <input ref={searchRef} autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && meds[0]) add(meds[0]); }}
            placeholder="Search medicine or scan barcode (F2)" aria-label="Search medicine" className={`${input} pl-9`} />
        </div>
        <ul className="flex flex-col divide-y divide-line text-sm border border-line rounded-lg max-h-[480px] overflow-auto">
          {meds.map((m) => (
            <li key={m.id}>
              <button className="w-full text-left px-3 py-2 hover:bg-page flex justify-between gap-2 cursor-pointer disabled:opacity-50" onClick={() => add(m)} disabled={m.stock <= 0} aria-label={m.name}>
                <span>{m.name}{m.schedule ? <span className="text-bad"> · Sch {m.schedule}</span> : null}{m.generic ? <span className="text-muted"> · {m.generic}</span> : null}</span>
                <span className="text-muted whitespace-nowrap">{inr(m.mrpPaise)} · {m.stock > 0 ? stockText(m) : "out of stock"}</span>
              </button>
            </li>
          ))}
          {!meds.length && <li className="px-3 py-2 text-muted">No match.</li>}
        </ul>
      </div>

      <div className="flex flex-col gap-4">
        <div className={card}>
          <div className="flex justify-between text-sm"><span className="font-medium">Cart</span><span className="text-muted">{cfg.branchName} · series {cfg.series}</span></div>
          {cart.map((l, i) => (
            <div key={`${l.med.id}-${l.unit}`} className="flex items-center gap-2 text-sm">
              <div className="flex-1 min-w-0"><div className="truncate">{l.med.name}</div><div className="text-muted text-xs">{inr(price(l))} per {l.unit === "loose" ? l.med.looseUnit : l.med.packUnit}</div></div>
              {l.med.allowLoose && l.med.packSize > 1 ? (
                <select value={l.unit} onChange={(e) => setLine(i, { unit: e.target.value as Line["unit"] })} className="border border-line rounded-md h-8 text-xs px-1" aria-label="Unit">
                  <option value="pack">{l.med.packUnit}</option><option value="loose">{l.med.looseUnit}</option>
                </select>
              ) : null}
              <button onClick={() => setLine(i, { qty: l.qty - 1 })} aria-label="Less" className="p-1 cursor-pointer"><Minus size={14} /></button>
              <span className="w-6 text-center tabular-nums">{l.qty}</span>
              <button onClick={() => setLine(i, { qty: l.qty + 1 })} aria-label="More" className="p-1 cursor-pointer"><Plus size={14} /></button>
              <span className="w-20 text-right tabular-nums">{inr(price(l) * l.qty)}</span>
              <button onClick={() => setLine(i, { qty: 0 })} aria-label="Remove" className="p-1 text-muted hover:text-bad cursor-pointer"><Trash2 size={14} /></button>
            </div>
          ))}
          {!cart.length && <div className="text-sm text-muted">Search and tap a medicine, or press Enter to add the first match.</div>}
          <div className="border-t border-line pt-3 flex flex-col gap-2 text-sm">
            {cust ? (
              <div className="flex justify-between"><span>{cust.name}{cust.phone ? ` · ${cust.phone}` : ""}{cust.balancePaise ? <span className="text-muted"> · owes {inr(cust.balancePaise)}</span> : null}</span><button className="text-teal cursor-pointer" onClick={() => { setCust(null); if (mode === "credit") setMode("cash"); }}>Change</button></div>
            ) : (
              <div className="relative">
                <input value={custQ} onChange={(e) => setCustQ(e.target.value)} placeholder="Customer mobile or name (optional)" className={input} aria-label="Customer" />
                {custs.length > 0 && (
                  <ul className="absolute z-10 left-0 right-0 mt-1 bg-white border border-line rounded-lg shadow divide-y divide-line">
                    {custs.map((c) => <li key={c.id}><button className="w-full text-left px-3 py-2 hover:bg-page cursor-pointer" onClick={() => { setCust(c); setCusts([]); }}>{c.name} <span className="text-muted">{c.phone}</span></button></li>)}
                  </ul>
                )}
              </div>
            )}
            {needRx && <input value={rx.prescriber} onChange={(e) => setRx({ ...rx, prescriber: e.target.value })} placeholder="Prescriber (doctor) name" className={input} aria-label="Prescriber" />}
            {needH1 && (
              <div className="grid grid-cols-2 gap-2">
                <input value={rx.prescriberReg} onChange={(e) => setRx({ ...rx, prescriberReg: e.target.value })} placeholder="Doctor’s reg. no." className={input} aria-label="Registration number" />
                <input value={rx.patientName} onChange={(e) => setRx({ ...rx, patientName: e.target.value })} placeholder="Patient name" className={input} aria-label="Patient name" />
              </div>
            )}
            <label className="flex items-center justify-between gap-2">Discount % <span className="text-muted text-xs">(up to {cap}%)</span>
              <input type="number" min={0} max={cap} value={disc} onChange={(e) => setDisc(Math.max(0, Math.min(100, Number(e.target.value) || 0)))} className="border border-line rounded-lg px-2 h-8 w-20 text-right" aria-label="Discount percent" />
            </label>
            <div className="flex gap-1.5 flex-wrap" role="radiogroup" aria-label="Payment">
              {(["cash", "upi", "card", "credit"] as const).filter((m) => m !== "credit" || (who.canCredit && cust)).map((m) => (
                <button key={m} role="radio" aria-checked={mode === m} onClick={() => setMode(m)} className={`px-3 h-8 rounded-lg border text-[13px] cursor-pointer ${mode === m ? "bg-teal text-white border-teal" : "border-line"}`}>{m.toUpperCase()}</button>
              ))}
            </div>
            <div className="flex justify-between text-base font-semibold pt-1"><span>Total</span><span className="tabular-nums">{inr(estTotal)}</span></div>
            <Button variant="primary" size="lg" onClick={complete} disabled={busy || !cart.length}><Receipt size={18} /> {busy ? "Saving…" : "Complete bill (F9)"}</Button>
          </div>
        </div>
        {side}
      </div>
    </div>
  );
}
