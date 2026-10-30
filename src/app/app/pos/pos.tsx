"use client";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useSearchParams } from "next/navigation";
import { Search, ScanBarcode, Trash2, FileText, Check, Printer, FileDown, MessageCircle, UserPlus, CircleAlert } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { Checkbox, Field, Input } from "@/components/ui/field";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/components/ui/cn";
import { cartTotals, inr, inr0, toPaise } from "@/lib/money";
import { daysTo, monthYear, hhmm } from "@/lib/dates";
import { isSellable, nextFefo } from "@/domain/inventory/fefo";
import { getDevice } from "@/lib/offline/store";
import type { Invoice, SaleMedicine } from "@/domain/sales/service";
import { addCustomerAction, approveDiscountAction, commitSaleAction, holdAction, invoiceAction, messageStatusAction, recallAction, searchAction, sendInvoiceAction } from "./actions";

type Customer = { id: string; name: string; phone: string | null; optIn: boolean; limit: number; due: number };
type Line = { key: string; medicineId: string; batchId: string; qty: number };
type Pay = "cash" | "upi" | "card" | "split" | "credit";
type Cart = { lines: Line[]; meds: Record<string, SaleMedicine>; cust: string; disc: string; pay: Pay; tender: string; split: string; ref: string; doctor: string; rxno: string; docreg?: string; patient?: string };
type Dict = { search: string; cart: string; customer: string; payment: string; total: string; complete: string; hold: string };

const empty = (): Cart => ({ lines: [], meds: {}, cust: "", disc: "0", pay: "cash", tender: "", split: "", ref: "", doctor: "", rxno: "" });
const newKey = () => "k_" + crypto.randomUUID().replace(/-/g, "");
const card = "bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)]";
const inp = "border border-input rounded-lg px-[11px] py-[9px] text-[14px] outline-none bg-white focus:border-teal w-full";

export function Pos({ dict: t, customers: initialCustomers, held: initialHeld, canCredit, discCap, maxDisc, role, storageKey, waConnected }: {
  dict: Dict; customers: Customer[]; held: { id: string; label: string }[]; canCredit: boolean; discCap: number; maxDisc: number; role: string; storageKey: string; waConnected: boolean;
}) {
  const toast = useToast();
  const sp = useSearchParams();
  const searchRef = useRef<HTMLInputElement>(null);
  const [cart, setCart] = useState<Cart>(empty);
  const [loaded, setLoaded] = useState(false);
  const [customers, setCustomers] = useState(initialCustomers);
  const [held, setHeld] = useState(initialHeld);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<SaleMedicine[] | null>(null);
  const [hl, setHl] = useState(0);
  const [busy, setBusy] = useState(false);
  const [netDown, setNetDown] = useState(false);
  const [sale, setSale] = useState<Invoice | null>(null);
  const [newCust, setNewCust] = useState(false);
  const [approval, setApproval] = useState<{ token: string; sig: string; by: string } | null>(null);
  const [askApproval, setAskApproval] = useState(false);
  // The key stays the same only while retrying the exact same bill after a network error.
  const idemRef = useRef<{ key: string; sig: string | null }>({ key: newKey(), sig: null });
  const freshKey = () => { idemRef.current = { key: newKey(), sig: null }; };
  const [, start] = useTransition();

  // Restore the cart after a reload or crash; save it on every change.
  useEffect(() => {
    try { const s = localStorage.getItem(storageKey); if (s) setCart({ ...empty(), ...JSON.parse(s) }); } catch {}
    setLoaded(true);
  }, [storageKey]);
  useEffect(() => { if (loaded) try { localStorage.setItem(storageKey, JSON.stringify(cart)); } catch {} }, [cart, loaded, storageKey]);
  useEffect(() => { if (sp.get("focus")) searchRef.current?.focus(); }, [sp]);
  // Customers and held carts change on other counters; take fresh server data without touching the cart.
  useEffect(() => setCustomers(initialCustomers), [initialCustomers]);
  useEffect(() => setHeld(initialHeld), [initialHeld]);

  const set = (p: Partial<Cart>) => setCart((c) => ({ ...c, ...p }));
  const used = (lines: Line[], batchId: string, except?: string) => lines.filter((l) => l.batchId === batchId && l.key !== except).reduce((a, l) => a + l.qty, 0);
  const usedMap = (lines: Line[]) => lines.reduce<Record<string, number>>((m, l) => ({ ...m, [l.batchId]: (m[l.batchId] ?? 0) + l.qty }), {});
  const batchOf = (c: Cart, l: Line) => c.meds[l.medicineId]?.batches.find((b) => b.id === l.batchId);

  // Search (debounced). A full barcode followed by Enter adds the item directly.
  useEffect(() => {
    const term = q.trim();
    if (!term) { setResults(null); return; }
    const h = setTimeout(() => searchAction(term).then((r) => { setResults(r); setHl(0); }), 120);
    return () => clearTimeout(h);
  }, [q]);

  const add = useCallback((m: SaleMedicine) => {
    setCart((c) => {
      const meds = { ...c.meds, [m.id]: m };
      const b = nextFefo(m.batches, m.id, usedMap(c.lines));
      if (!b) { toast(`${m.name}: no sellable stock. Expired and quarantined batches are blocked.`, "red"); return c; }
      const ex = c.lines.find((l) => l.batchId === b.id);
      const lines = ex ? c.lines.map((l) => (l === ex ? { ...l, qty: l.qty + 1 } : l)) : [...c.lines, { key: newKey(), medicineId: m.id, batchId: b.id, qty: 1 }];
      return { ...c, meds, lines };
    });
    setQ(""); setResults(null);
  }, [toast]);

  const inc = (key: string) => setCart((c) => {
    const l = c.lines.find((x) => x.key === key)!, b = batchOf(c, l)!;
    if (used(c.lines, b.id) < b.qtyAvailable) return { ...c, lines: c.lines.map((x) => (x.key === key ? { ...x, qty: x.qty + 1 } : x)) };
    const nb = nextFefo(c.meds[l.medicineId].batches, l.medicineId, usedMap(c.lines));
    if (nb) { toast(`Batch ${b.batchNo} exhausted. Next FEFO batch ${nb.batchNo} added.`, "blue"); return { ...c, lines: [...c.lines, { key: newKey(), medicineId: l.medicineId, batchId: nb.id, qty: 1 }] }; }
    toast(`Only ${c.meds[l.medicineId].batches.filter((x) => isSellable(x)).reduce((a, x) => a + x.qtyAvailable, 0)} sellable in stock.`, "red");
    return c;
  });
  const dec = (key: string) => set({ lines: cart.lines.map((x) => (x.key === key ? { ...x, qty: x.qty - 1 } : x)).filter((x) => x.qty > 0) });
  const setQty = (key: string, v: string) => setCart((c) => {
    const l = c.lines.find((x) => x.key === key)!, b = batchOf(c, l)!;
    let n = parseInt(v.replace(/\D/g, ""), 10); if (!n || n < 1) n = 1;
    const max = b.qtyAvailable - used(c.lines, b.id, key);
    if (n > max) { n = max; toast(`Only ${max} available in batch ${b.batchNo}`, "amber"); }
    return { ...c, lines: c.lines.map((x) => (x.key === key ? { ...x, qty: n } : x)) };
  });
  const setBatch = (key: string, batchId: string) => setCart((c) => {
    const l = c.lines.find((x) => x.key === key)!, b = c.meds[l.medicineId].batches.find((x) => x.id === batchId)!;
    if (!isSellable(b)) { toast("That batch is blocked for sale.", "red"); return c; }
    const max = b.qtyAvailable - used(c.lines, b.id, key);
    if (max < 1) { toast(`Batch ${b.batchNo} is already fully in the cart.`, "amber"); return c; }
    if (l.qty > max) toast(`Quantity reduced to ${max} (batch availability).`, "amber");
    return { ...c, lines: c.lines.map((x) => (x.key === key ? { ...x, batchId, qty: Math.min(x.qty, max) } : x)) };
  });

  const disc = parseFloat(cart.disc) || 0;
  const totals = useMemo(() => cartTotals(cart.lines.map((l) => {
    const m = cart.meds[l.medicineId], b = m?.batches.find((x) => x.id === l.batchId);
    return { mrpPaise: b?.mrp ?? 0, qty: l.qty, gstRate: m?.gstRate ?? 0 };
  }), disc), [cart.lines, cart.meds, disc]);
  // A manager's approval fits only the cart and discount it was given for.
  const approvalSig = JSON.stringify([cart.lines.map((l) => [l.batchId, l.qty]), disc]);
  const approved = !!approval && approval.sig === approvalSig;
  const cust = customers.find((c) => c.id === cart.cust);
  const needsRx = cart.lines.some((l) => cart.meds[l.medicineId]?.schedule);

  const checkoutError = () => {
    if (!cart.lines.length) return "Cart is empty.";
    if (disc < 0 || disc > maxDisc) return `Discounts above ${maxDisc}% aren’t allowed.`;
    if (disc > discCap && !approved) return `Discount above ${discCap}% needs manager approval.`;
    if (needsRx && !cart.doctor.trim()) return "Enter prescriber name for Schedule H/H1 items.";
    if (cart.pay === "cash" && cart.tender && toPaise(cart.tender) < totals.total) return "Cash tendered is less than the total.";
    if (cart.pay === "split" && (!cart.split || toPaise(cart.split) <= 0 || toPaise(cart.split) >= totals.total)) return "Enter a cash part between ₹1 and the total.";
    if (cart.pay === "credit") {
      if (!cust) return "Select a customer for a credit sale.";
      if (cust.due + totals.total > cust.limit) return `Exceeds ${cust.name}'s credit limit (${inr0(cust.limit)}).`;
    }
    return null;
  };

  const complete = useCallback(async () => {
    if (busy || sale) return;
    const err = checkoutError();
    if (err) { toast(err, "red"); return; }
    setBusy(true);
    const body = {
      lines: cart.lines.map((l) => ({ medicineId: l.medicineId, batchId: l.batchId, qty: l.qty })),
      customerId: cart.cust || null, discountPct: disc,
      pay: { mode: cart.pay, cashPaise: cart.pay === "split" ? toPaise(cart.split) : undefined, tenderedPaise: cart.pay === "cash" && cart.tender ? toPaise(cart.tender) : undefined, ref: cart.ref || undefined },
      prescriber: cart.doctor || undefined, rxNo: cart.rxno || undefined, prescriberReg: cart.docreg || undefined, patientName: cart.patient || undefined,
    };
    const sig = JSON.stringify(body);
    if (idemRef.current.sig !== null && idemRef.current.sig !== sig) freshKey();
    idemRef.current.sig = sig;
    try {
      const r = await commitSaleAction({ idempotencyKey: idemRef.current.key, ...body, approval: disc > discCap && approved ? approval!.token : undefined });
      setNetDown(false);
      if (!r.ok) {
        toast(r.error, "red");
        if (/already used/.test(r.error)) freshKey();
        if (/approv/.test(r.error)) setApproval(null);
        // Refresh batch info so the cashier sees current stock.
        if (/Stock changed|blocked|expired|quarantined/.test(r.error)) {
          const ids = [...new Set(cart.lines.map((l) => l.medicineId))];
          const fresh = await Promise.all(ids.map((id) => searchAction(cart.meds[id].name)));
          setCart((c) => ({ ...c, meds: { ...c.meds, ...Object.fromEntries(fresh.flat().filter((m) => ids.includes(m.id)).map((m) => [m.id, m])) } }));
        }
        return;
      }
      const inv = await invoiceAction(r.data.saleId);
      setSale(inv);
      setCart(empty());
      freshKey();
      setApproval(null);
    } catch {
      // The request may have reached the server; the idempotency key is kept so a retry posts at most once.
      toast("Couldn’t reach the server. Check the connection and press Complete again; the bill won’t be posted twice.", "red");
      setNetDown(await getDevice().then((d) => !!d, () => false));
    } finally {
      setBusy(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, sale, cart, disc, totals, cust, needsRx, approval, approved]);

  const hold = useCallback(() => {
    if (!cart.lines.length) return;
    const label = `Held ${hhmm(new Date())} · ${cart.lines.length} item${cart.lines.length > 1 ? "s" : ""} · ${inr0(totals.total)}`;
    start(async () => {
      const r = await holdAction(label, cart);
      if (!r.ok) return toast(r.error, "red");
      setHeld(r.data); setCart(empty()); freshKey(); toast("Cart held. Recall it from the bar above the cart.", "blue");
    });
  }, [cart, totals.total, toast]);

  const recall = (id: string) => {
    if (cart.lines.length) return toast("Hold or clear the current cart first.", "amber");
    start(async () => {
      const r = await recallAction(id);
      if (!r.ok) return toast("That held cart was already recalled on another counter.", "amber");
      setCart({ ...empty(), ...(r.data.cart as Cart) }); setHeld(r.data.held); freshKey();
    });
  };

  useEffect(() => {
    const k = (e: KeyboardEvent) => {
      if (e.key === "F2") { e.preventDefault(); e.stopImmediatePropagation(); if (!sale) searchRef.current?.focus(); }
      else if (e.key === "F9") { e.preventDefault(); complete(); }
      else if (e.key === "F4") { e.preventDefault(); if (!sale) hold(); }
    };
    window.addEventListener("keydown", k, true);
    return () => window.removeEventListener("keydown", k, true);
  }, [complete, hold, sale]);

  const onSearchKey = (e: React.KeyboardEvent) => {
    const res = results ?? [];
    if (e.key === "ArrowDown") { e.preventDefault(); setHl((h) => Math.min(h + 1, res.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHl((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") {
      e.preventDefault();
      if (res[hl]) add(res[hl]);
      else if (/^\d{6,}$/.test(q.trim())) searchAction(q.trim()).then((r) => { if (r[0]?.barcodeHit) add(r[0]); else toast(`No medicine has barcode ${q.trim()}.`, "red"); });
    } else if (e.key === "Escape") setQ("");
  };

  const payTabs: [Pay, string][] = [["cash", "Cash"], ["upi", "UPI"], ["card", "Card"], ["split", "Split"], ...(canCredit ? [["credit", "Credit"] as [Pay, string]] : [])];
  const tender = toPaise(cart.tender), splitCash = toPaise(cart.split);
  const unitCount = cart.lines.reduce((a, l) => a + l.qty, 0);

  return (
    <div className="grid gap-4 max-w-[1400px] items-start grid-cols-[minmax(0,1fr)_minmax(330px,380px)] max-[900px]:grid-cols-1">
      <div className="flex flex-col gap-3 min-w-0">
        <div className="relative flex gap-2">
          <div className="flex-1 relative">
            <Search size={18} className="absolute left-[13px] top-1/2 -translate-y-1/2 text-fainter" />
            <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onSearchKey} placeholder={t.search} autoFocus aria-label="Search medicine"
              className="w-full border-[1.5px] border-teal rounded-[10px] py-[13px] pr-14 pl-[42px] text-[16px] outline-none bg-white" />
            <span className="absolute right-3 top-1/2 -translate-y-1/2 font-mono text-[11.5px] text-fainter border border-[#E3E6E9] rounded px-[5px]">F2</span>
            {results && results.length ? (
              <div className="absolute left-0 right-0 top-[calc(100%+6px)] bg-white border border-input rounded-[10px] shadow-[0_12px_32px_rgba(0,0,0,.12)] z-20 overflow-hidden">
                {results.map((m, i) => {
                  const st = m.batches.filter((b) => isSellable(b)).reduce((a, b) => a + b.qtyAvailable, 0) - cart.lines.filter((l) => l.medicineId === m.id).reduce((a, l) => a + l.qty, 0);
                  const nb = nextFefo(m.batches, m.id, usedMap(cart.lines));
                  return (
                    <button key={m.id} onMouseDown={(e) => { e.preventDefault(); add(m); }} onMouseEnter={() => setHl(i)}
                      className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-3.5 items-center w-full border-b border-row px-3.5 py-2.5 text-left cursor-pointer" style={{ background: i === hl ? "#F0F7F6" : "#fff" }}>
                      <div className="flex flex-col min-w-0">
                        <div className="flex gap-1.5 items-center"><span className="font-semibold text-[14.5px]">{m.name}</span>{m.schedule ? <RxTag s={m.schedule} /> : null}</div>
                        <span className="text-[12.5px] text-muted truncate">{m.generic} · {m.strength} · {m.manufacturer}</span>
                      </div>
                      <div className="flex flex-col items-end">
                        <span className="text-[12.5px] font-semibold" style={{ color: st > 0 ? (st < m.reorderLevel ? "#94570A" : "#1E7F4F") : "#B3261E" }}>{st > 0 ? `${st} in stock` : "No sellable stock"}</span>
                        <span className="text-[11.5px] text-faint">{nb ? `FEFO ${nb.batchNo} · exp ${monthYear(nb.expiryDate)}` : ""}</span>
                      </div>
                      <span className="font-semibold tnum">{nb ? inr(nb.mrp) : m.batches[0] ? inr(m.batches[0].mrp) : "—"}</span>
                    </button>
                  );
                })}
                <div className="px-3.5 py-[7px] text-[11.5px] text-faint bg-subtle">↑ ↓ to select · Enter to add · batch picked by FEFO (expired & quarantined blocked)</div>
              </div>
            ) : results && q.trim() ? (
              <div className="absolute left-0 right-0 top-[calc(100%+6px)] bg-white border border-input rounded-[10px] p-3.5 z-20 text-[13.5px] text-muted">No medicine matches. Check spelling or try the generic name.</div>
            ) : null}
          </div>
        </div>

        {held.length ? (
          <div className="flex gap-2 flex-wrap items-center">
            <span className="text-[12.5px] text-muted">Held carts:</span>
            {held.map((h) => <button key={h.id} onClick={() => recall(h.id)} className="border border-dashed border-blue bg-blue-tint text-blue rounded-full px-2.5 py-1 text-[12.5px] cursor-pointer">{h.label}</button>)}
          </div>
        ) : null}

        <div className={card + " overflow-hidden"}>
          <div className="flex justify-between items-center px-4 py-3 border-b border-[#E3E6E9]">
            <div className="font-semibold text-[15px]">{t.cart}</div>
            <div className="text-[12.5px] text-muted">{unitCount} units · {cart.lines.length} lines</div>
          </div>
          {!cart.lines.length ? (
            <div className="py-12 px-5 text-center flex flex-col items-center gap-2 text-muted">
              <ScanBarcode size={30} className="text-teal-border" />
              <div className="text-[14.5px] font-medium text-ink">Scan a barcode or search to start a bill</div>
              <div className="text-[13px]">Barcode scanners type into the search box; Enter adds the item.</div>
            </div>
          ) : cart.lines.map((l) => {
            const m = cart.meds[l.medicineId], b = batchOf(cart, l);
            if (!m || !b) return null;
            const d = daysTo(b.expiryDate);
            return (
              <div key={l.key} className="grid grid-cols-[minmax(0,1.6fr)_minmax(150px,1fr)_auto_auto_28px] gap-3 items-center px-4 py-3 border-b border-row max-[700px]:grid-cols-[minmax(0,1fr)_auto_28px]">
                <div className="flex flex-col min-w-0 gap-0.5">
                  <div className="flex gap-1.5 items-center flex-wrap"><span className="font-semibold">{m.name}</span>{m.schedule ? <RxTag s={m.schedule} /> : null}</div>
                  <span className="text-[12px] text-muted truncate">{m.generic} · {m.strength} · {m.pack}</span>
                  {d <= 45 ? <span className="text-[12px] text-warn">Expires in {d} days</span> : null}
                </div>
                <select value={l.batchId} onChange={(e) => setBatch(l.key, e.target.value)} aria-label={`Batch for ${m.name}`} className="border border-input rounded-[7px] px-2 py-1.5 text-[12.5px] bg-white min-w-0 w-full max-[700px]:order-last max-[700px]:col-span-3">
                  {m.batches.map((x) => <option key={x.id} value={x.id} disabled={!isSellable(x)}>{x.batchNo} · exp {monthYear(x.expiryDate)} · {x.qtyAvailable}{isSellable(x) ? "" : x.status !== "ok" ? " · quarantined" : " · expired"}</option>)}
                </select>
                <div className="flex items-center border border-input rounded-[7px] overflow-hidden">
                  <button onClick={() => dec(l.key)} aria-label="Decrease" className="bg-bg w-[30px] h-8 cursor-pointer text-[16px]">−</button>
                  <input value={l.qty} onChange={(e) => setQty(l.key, e.target.value)} aria-label="Quantity" className="w-10 text-center text-[14px] font-semibold outline-none tnum" inputMode="numeric" />
                  <button onClick={() => inc(l.key)} aria-label="Increase" className="bg-bg w-[30px] h-8 cursor-pointer text-[16px]">+</button>
                </div>
                <div className="flex flex-col items-end min-w-[86px] max-[700px]:hidden">
                  <span className="font-semibold tnum">{inr(b.mrp * l.qty)}</span>
                  <span className="text-[11.5px] text-faint">{inr(b.mrp)} · GST {m.gstRate}%</span>
                </div>
                <button onClick={() => set({ lines: cart.lines.filter((x) => x.key !== l.key) })} title="Remove" aria-label="Remove" className="text-fainter p-1 rounded-md cursor-pointer hover:text-bad"><Trash2 size={16} /></button>
              </div>
            );
          })}
        </div>
        <div className="text-[12px] text-faint flex gap-3.5 flex-wrap"><span>F2 search</span><span>↑↓ Enter add</span><span>F4 hold</span><span>F9 complete</span><span>Prices are MRP inclusive of GST</span></div>
      </div>

      <div className="flex flex-col gap-3 sticky top-0">
        <div className={card + " px-4 py-3.5 flex flex-col gap-2"}>
          <div className="flex items-center justify-between"><label className="text-[12.5px] text-muted font-medium" htmlFor="pos-cust">{t.customer}</label>
            <button onClick={() => setNewCust(true)} className="text-teal text-[12.5px] font-semibold flex items-center gap-1 cursor-pointer"><UserPlus size={13} />New</button></div>
          <select id="pos-cust" value={cart.cust} onChange={(e) => set({ cust: e.target.value })} className={inp}>
            <option value="">Walk-in customer (no details stored)</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone.slice(0, 5)} ${c.phone.slice(5)}` : ""}</option>)}
          </select>
          {cust ? <div className="text-[12.5px] text-muted">Outstanding {inr0(cust.due)} · limit {inr0(cust.limit)} · WhatsApp {cust.optIn ? "opted in" : "not opted in"}</div> : null}
          {needsRx ? (
            <div className="flex flex-col gap-1.5 p-2.5 bg-bad-bg rounded-lg mt-1">
              <div className="text-[12.5px] font-semibold text-bad flex gap-1.5 items-center"><FileText size={14} />Schedule H/H1: prescription required</div>
              <input value={cart.doctor} onChange={(e) => set({ doctor: e.target.value })} placeholder="Prescriber name *" aria-label="Prescriber name" className="border border-[#E5B4AE] rounded-[7px] px-2.5 py-2 text-[13.5px] bg-white outline-none" />
              <input value={cart.rxno} onChange={(e) => set({ rxno: e.target.value })} placeholder="Rx / register entry no." aria-label="Prescription number" className="border border-[#E5B4AE] rounded-[7px] px-2.5 py-2 text-[13.5px] bg-white outline-none" />
              {cart.lines.some((l) => ["H1", "X", "NDPS"].includes(cart.meds[l.medicineId]?.schedule ?? "")) ? <>
                <input value={cart.docreg ?? ""} onChange={(e) => set({ docreg: e.target.value })} placeholder="Prescriber registration no. (H1 register)" aria-label="Prescriber registration number" className="border border-[#E5B4AE] rounded-[7px] px-2.5 py-2 text-[13.5px] bg-white outline-none" />
                {cust ? null : <input value={cart.patient ?? ""} onChange={(e) => set({ patient: e.target.value })} placeholder="Patient name (H1 register)" aria-label="Patient name" className="border border-[#E5B4AE] rounded-[7px] px-2.5 py-2 text-[13.5px] bg-white outline-none" />}
              </> : null}
            </div>
          ) : null}
        </div>

        <div className={card + " px-4 py-3.5 flex flex-col gap-[7px] text-[13.5px]"}>
          <Row k="MRP total" v={inr(totals.mrpTotal)} />
          <div className="flex justify-between items-center gap-2">
            <span className="text-muted">Discount % <span className="text-[11.5px]">(max {discCap}% for {role})</span></span>
            <div className="flex items-center gap-2"><input value={cart.disc} onChange={(e) => set({ disc: e.target.value.replace(/[^\d.]/g, "") })} aria-label="Discount percent" className="w-[54px] border border-input rounded-md px-1.5 py-1 text-right text-[13.5px]" /><span className="tnum min-w-[70px] text-right">{inr(-totals.discount)}</span></div>
          </div>
          {disc > discCap ? (
            disc > maxDisc ? <div className="text-[12.5px] text-bad">Discounts above {maxDisc}% aren’t allowed.</div>
              : approved ? <div className="text-[12.5px] text-ok flex gap-1.5 items-center"><Check size={14} />Approved by {approval!.by} for this cart</div>
              : <button onClick={() => cart.lines.length ? setAskApproval(true) : toast("Add items first.", "amber")} className="self-end text-[12.5px] font-semibold text-teal cursor-pointer">Get manager approval for {disc}%</button>
          ) : null}
          <Row k="Taxable value" v={inr(totals.taxable)} /><Row k="CGST" v={inr(totals.cgst)} /><Row k="SGST" v={inr(totals.sgst)} /><Row k="Round off" v={inr(totals.roundOff)} />
          <div className="flex justify-between items-baseline border-t border-[#E3E6E9] pt-2.5 mt-[3px]"><span className="font-semibold text-[14px]">{t.total}</span><span className="text-[26px] font-bold tracking-[-.01em] tnum">{inr(totals.total)}</span></div>
        </div>

        <div className={card + " px-4 py-3.5 flex flex-col gap-2.5"}>
          <label className="text-[12.5px] text-muted font-medium">{t.payment}</label>
          <div className="flex gap-1.5 flex-wrap">
            {payTabs.map(([id, label]) => (
              <button key={id} onClick={() => set({ pay: id })} className="flex-1 min-w-[58px] border rounded-lg px-1.5 py-2 text-[13.5px] font-semibold cursor-pointer"
                style={cart.pay === id ? { background: "#0B5E5B", color: "#fff", borderColor: "#0B5E5B" } : { background: "#fff", color: "#1F2328", borderColor: "#CDD2D7" }}>{label}</button>
            ))}
          </div>
          {cart.pay === "cash" ? <div className="flex flex-col gap-[5px]"><input value={cart.tender} onChange={(e) => set({ tender: e.target.value.replace(/[^\d.]/g, "") })} placeholder="Cash tendered (₹)" aria-label="Cash tendered" className={inp} inputMode="decimal" /><span className="text-[12.5px] text-ok">{tender > totals.total ? `Change to return: ${inr(tender - totals.total)}` : "Leave blank for exact cash"}</span></div> : null}
          {cart.pay === "upi" ? <div className="flex flex-col gap-[5px]"><div className="text-[12.5px] text-muted">Confirm the credit in your bank app, then enter the UTR.</div><input value={cart.ref} onChange={(e) => set({ ref: e.target.value })} placeholder="UPI UTR / reference (optional)" className={inp} /></div> : null}
          {cart.pay === "card" ? <input value={cart.ref} onChange={(e) => set({ ref: e.target.value })} placeholder="Card terminal approval code" className={inp} /> : null}
          {cart.pay === "split" ? <div className="flex flex-col gap-[5px]"><input value={cart.split} onChange={(e) => set({ split: e.target.value.replace(/[^\d.]/g, "") })} placeholder="Cash part (₹)" aria-label="Cash part" className={inp} inputMode="decimal" /><span className="text-[12.5px] text-blue">Balance on UPI: {inr(Math.max(0, totals.total - splitCash))}</span></div> : null}
          {cart.pay === "credit" ? <div className="text-[12.5px] text-warn bg-warn-bg px-2.5 py-2 rounded-[7px]">{cust ? `After this sale: ${inr0(cust.due + totals.total)} of ${inr0(cust.limit)} limit` : "Select a customer to sell on credit"}</div> : null}
          <button onClick={complete} disabled={busy} className="text-white rounded-[10px] p-3.5 text-[15.5px] font-bold cursor-pointer flex justify-center gap-2 items-center disabled:cursor-wait"
            style={{ background: cart.lines.length && !busy ? "#0B5E5B" : "#8DB5B1" }}>
            {busy ? "Committing sale…" : `${t.complete} · ${inr(totals.total)}`}<span className="font-mono text-[11px] opacity-80 border border-white/50 rounded px-1">F9</span>
          </button>
          {netDown ? (
            <div className="text-[12.5px] text-warn bg-warn-bg px-2.5 py-2 rounded-[7px]">
              Still no connection? This counter has offline billing. Retry first (the bill may already be saved), then <a href="/offline" className="font-semibold underline">open offline billing</a>.
            </div>
          ) : null}
          <div className="flex gap-2">
            <Button className="flex-1" onClick={hold}>{t.hold} (F4)</Button>
            <Button className="flex-1 text-bad" onClick={() => { if (cart.lines.length && !confirm("Clear this cart?")) return; setCart(empty()); freshKey(); }}>Clear</Button>
          </div>
        </div>
      </div>

      <SaleModal sale={sale} waConnected={waConnected} onNew={() => { setSale(null); setTimeout(() => searchRef.current?.focus(), 50); }} />
      <NewCustomer open={newCust} canCredit={canCredit} onClose={() => setNewCust(false)} onSaved={(id, list) => { setCustomers(list); set({ cust: id }); setNewCust(false); }} />
      <ApproveDiscount open={askApproval} disc={disc} total={totals.total} lines={cart.lines} onClose={() => setAskApproval(false)}
        onApproved={(token, by) => { setApproval({ token, sig: approvalSig, by }); setAskApproval(false); toast(`Discount approved by ${by}.`, "green"); }} />
    </div>
  );
}

function Row({ k, v }: { k: string; v: string }) {
  return <div className="flex justify-between"><span className="text-muted">{k}</span><span className="tnum">{v}</span></div>;
}

function RxTag({ s }: { s: string }) {
  return <span className="text-[11px] font-semibold text-bad border border-[#F0B8B2] rounded px-1">Rx {s}</span>;
}

const WA_STEPS = ["queued", "sent", "delivered", "read"] as const;

function SaleModal({ sale, waConnected, onNew }: { sale: Invoice | null; waConnected: boolean; onNew: () => void }) {
  const toast = useToast();
  const [phone, setPhone] = useState(""), [verified, setVerified] = useState(false);
  const [msg, setMsg] = useState<{ status: string; attempts: number; error: string | null } | null>(null);
  const [sending, setSending] = useState(false);
  useEffect(() => {
    setPhone(sale?.customer?.phone ?? ""); setVerified(false); setMsg(null);
    if (!sale) return;
    // Auto-send may already have queued a message for this sale.
    let live = true;
    messageStatusAction(sale.id).then((m) => { if (live && m) setMsg(m); }, () => {});
    return () => { live = false; };
  }, [sale]);
  // Delivery updates arrive through Meta's webhook; poll the stored status while the receipt is open.
  // With no message yet, keep checking for opted-in customers, whose invoice auto-send runs in the background.
  useEffect(() => {
    if (!sale || (msg ? msg.status === "read" || msg.status === "failed" : !sale.customer?.optIn)) return;
    const t = setInterval(() => messageStatusAction(sale.id).then((m) => m && setMsg(m), () => {}), 3000);
    return () => clearInterval(t);
  }, [sale, msg]);
  if (!sale) return null;
  const s = sale;
  const payLabel = s.payments.length > 1 ? s.payments.map((p) => `${p.mode.toUpperCase()} ${inr(p.amount)}`).join(" + ") : s.payMode.toUpperCase();
  const print = (format: "thermal" | "a4") => {
    // "noopener" in the features makes window.open return null even when the tab opened.
    const w = window.open(`/print/invoice/${s.id}?format=${format}`, "_blank");
    if (!w) toast("Allow pop-ups to print invoices.", "amber");
    else w.opener = null;
  };
  const when = new Date(s.at);
  const failed = msg?.status === "failed";
  const idx = msg ? WA_STEPS.indexOf(msg.status as (typeof WA_STEPS)[number]) : -1;
  const canSend = verified && !sending && (!msg || (failed && msg.attempts < 3));
  const send = async () => {
    setSending(true);
    const r = await sendInvoiceAction(s.id, phone, verified);
    setSending(false);
    if (!r.ok) { toast(r.error, "red"); setMsg(await messageStatusAction(s.id)); return; }
    setMsg(await messageStatusAction(s.id));
  };
  return (
    <Modal open onClose={onNew} width={900} className="overflow-hidden">
      <div className="grid grid-cols-[repeat(auto-fit,minmax(300px,1fr))] -mx-6 -mb-5">
        <div className="px-6 py-[22px] flex flex-col gap-3.5">
          <div className="flex gap-3 items-center">
            <div className="size-10 rounded-full bg-ok-bg text-ok flex items-center justify-center"><Check size={22} /></div>
            <div className="flex flex-col"><div className="font-semibold text-[17px]">Sale committed</div><div className="text-[13px] text-muted font-mono">{s.invoiceNo}</div></div>
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[13.5px]">
            <span className="text-muted">Customer</span><span>{s.customer?.name ?? "Walk-in customer"}</span>
            <span className="text-muted">Total</span><span className="font-semibold">{inr(s.totals.total)}</span>
            <span className="text-muted">Payment</span><span>{payLabel}</span>
            <span className="text-muted">Prescriber</span><span>{s.prescriber ?? "—"}</span>
            <span className="text-muted">Idempotency key</span><span className="font-mono text-[12px] break-all">{s.idempotencyKey}</span>
          </div>
          <div className="flex gap-2">
            <Button className="flex-1 h-10" onClick={() => print("thermal")}><Printer size={16} />Thermal 80mm</Button>
            <Button className="flex-1 h-10" onClick={() => print("a4")}><FileDown size={16} />A4 / PDF</Button>
          </div>
          <div className="border border-[#CFE6D8] bg-[#F6FBF8] rounded-[10px] p-3.5 flex flex-col gap-2.5">
            <div className="flex items-center gap-2 font-semibold text-[14px]"><MessageCircle size={18} className="text-ok" />Send invoice on WhatsApp</div>
            {waConnected ? (
              <>
                <input value={phone} disabled={!!msg && !failed} onChange={(e) => { setPhone(e.target.value.replace(/[^\d ]/g, "")); setVerified(false); }} placeholder="Customer mobile (10 digits)" aria-label="WhatsApp number" className={inp + " text-[15px] tnum"} />
                <Checkbox checked={verified} disabled={!!msg && !failed} onChange={(e) => setVerified(e.target.checked)} label="I read the number back to the customer and they consent" />
                <button disabled={!canSend} onClick={send} className="text-white rounded-lg py-2.5 text-[14px] font-semibold cursor-pointer disabled:cursor-not-allowed" style={{ background: canSend ? "#1E7F4F" : "#A9CDB9" }}>
                  {sending ? "Sending…" : !msg ? "Send invoice PDF" : failed ? (msg.attempts >= 3 ? "Retry limit reached" : "Retry send") : `Sent · ${msg.status}`}
                </button>
                <div className="flex gap-1 items-center">
                  {WA_STEPS.map((k, i) => (
                    <div key={k} className="flex-1 flex flex-col gap-1 items-center">
                      <div className="w-full h-1 rounded-sm" style={{ background: failed ? (i === 0 ? "#B3261E" : "#CDD2D7") : i <= idx ? "#1E7F4F" : "#CDD2D7" }} />
                      <span className="text-[11.5px]" style={{ color: i <= idx && !failed ? "#1F2328" : "#8A929A" }}>{k[0].toUpperCase() + k.slice(1)}</span>
                    </div>
                  ))}
                </div>
                {failed ? <div className="text-[12.5px] text-bad flex gap-1.5 items-center"><CircleAlert size={14} />Failed: {msg.error ?? "unknown"}. Fix the number and retry (max 3).</div> : null}
              </>
            ) : (
              <div className="text-[12.5px] text-muted flex gap-1.5"><CircleAlert size={14} className="mt-0.5 flex-none" />WhatsApp Business isn’t connected yet. An owner can connect it under WhatsApp.</div>
            )}
            <div className="text-[11.5px] text-faint">PDF generated from the committed invoice on your server. Prescriber details are left out. Not stored by Medoro.</div>
          </div>
          <Button variant="primary" size="lg" onClick={onNew} autoFocus>New sale</Button>
        </div>
        <div className="bg-bg p-[22px] flex justify-center items-start">
          <div className="w-[300px] bg-white px-4 py-[18px] font-mono text-[11.5px] leading-normal text-ink shadow-[0_2px_8px_rgba(0,0,0,.08)] flex flex-col gap-1.5">
            <div className="text-center flex flex-col"><strong className="text-[13px] uppercase">{s.pharmacy.name}</strong>{s.pharmacy.address ? <span>{s.pharmacy.address}</span> : null}<span>{s.pharmacy.gstin ? `GSTIN ${s.pharmacy.gstin}` : ""}{s.pharmacy.dl ? ` · DL ${s.pharmacy.dl}` : ""}</span></div>
            <div className="border-t border-dashed border-fainter pt-1.5 flex justify-between"><span>{s.invoiceNo}</span><span>{hhmm(when)}</span></div>
            <div>{s.customer?.name ?? "Walk-in customer"}</div>
            <div className="border-t border-dashed border-fainter pt-1.5 flex flex-col gap-[3px]">
              {s.lines.map((l, i) => <div key={i} className="flex justify-between gap-2.5"><span>{l.qty} × {l.name} ({l.batchNo})</span><span className="whitespace-nowrap">{inr(l.amount)}</span></div>)}
              {[["Discount", -s.totals.discount], ["Taxable value", s.totals.taxable], ["CGST", s.totals.cgst], ["SGST", s.totals.sgst], ["Round off", s.totals.roundOff]].map(([k, v]) => (
                <div key={k as string} className="flex justify-between gap-2.5"><span>{k}</span><span className="whitespace-nowrap">{inr(v as number)}</span></div>
              ))}
            </div>
            <div className="border-t border-dashed border-fainter pt-1.5 flex justify-between text-[14px] font-semibold"><span>TOTAL</span><span>{inr(s.totals.total)}</span></div>
            <div className="text-center text-muted border-t border-dashed border-fainter pt-1.5">Paid by {payLabel} · Thank you</div>
          </div>
        </div>
      </div>
    </Modal>
  );
}

function NewCustomer({ open, canCredit, onClose, onSaved }: { open: boolean; canCredit: boolean; onClose: () => void; onSaved: (id: string, list: Customer[]) => void }) {
  const [f, setF] = useState({ name: "", phone: "", waOptIn: false, marketingWa: false, creditLimit: "" });
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  useEffect(() => { if (open) { setF({ name: "", phone: "", waOptIn: false, marketingWa: false, creditLimit: "" }); setErr(""); } }, [open]);
  const save = () => start(async () => {
    const r = await addCustomerAction(f);
    if (!r.ok) return setErr(r.error);
    onSaved(r.data.id, r.data.customers);
  });
  return (
    <Modal open={open} onClose={onClose} title="New customer" sub="Only what’s needed for the bill. Walk-in sales store no customer details."
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={pending}>Save customer</Button></>}>
      <Field label="Name *"><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} autoFocus /></Field>
      <Field label="Mobile"><Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} inputMode="tel" placeholder="98220 41736" /></Field>
      {canCredit ? <Field label="Credit limit ₹" hint="Leave 0 for cash-only customers."><Input value={f.creditLimit} onChange={(e) => setF({ ...f, creditLimit: e.target.value.replace(/[^\d.]/g, "") })} inputMode="decimal" placeholder="0" /></Field> : null}
      <Checkbox checked={f.waOptIn} onChange={(e) => setF({ ...f, waOptIn: e.target.checked })} label="Customer agrees to receive invoices and reminders on WhatsApp (recorded with your name and time)" />
      <Checkbox checked={f.marketingWa} onChange={(e) => setF({ ...f, marketingWa: e.target.checked })} label="Customer also agrees to offers on WhatsApp (marketing, optional)" />
      {err ? <div role="alert" className={cn("text-[13px] text-bad")}>{err}</div> : null}
    </Modal>
  );
}

function ApproveDiscount({ open, disc, total, lines, onClose, onApproved }: { open: boolean; disc: number; total: number; lines: Line[]; onClose: () => void; onApproved: (token: string, by: string) => void }) {
  const [f, setF] = useState({ approver: "", secret: "" });
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  useEffect(() => { if (open) { setF({ approver: "", secret: "" }); setErr(""); } }, [open]);
  const approve = () => start(async () => {
    const r = await approveDiscountAction({ ...f, discountPct: disc, lines: lines.map((l) => ({ medicineId: l.medicineId, batchId: l.batchId, qty: l.qty })) });
    if (!r.ok) { setF((x) => ({ ...x, secret: "" })); return setErr(r.error); }
    onApproved(r.data.token, r.data.approver);
  });
  return (
    <Modal open={open} onClose={onClose} title={`Approve ${disc}% discount`} sub={`Bill total after discount ${inr(total)}. A manager enters their own ID and PIN or password; it is recorded in the audit trail.`}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={approve} disabled={pending || !f.approver || !f.secret}>Approve</Button></>}>
      <Field label="Manager’s employee ID, email or mobile"><Input value={f.approver} onChange={(e) => setF({ ...f, approver: e.target.value })} autoFocus autoComplete="off" /></Field>
      <Field label="Manager’s PIN or password"><Input type="password" value={f.secret} onChange={(e) => setF({ ...f, secret: e.target.value })} onKeyDown={(e) => { if (e.key === "Enter" && f.approver && f.secret) approve(); }} autoComplete="off" /></Field>
      {err ? <div role="alert" className="text-[13px] text-bad">{err}</div> : null}
    </Modal>
  );
}