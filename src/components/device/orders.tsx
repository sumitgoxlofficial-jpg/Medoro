"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Trash2, Package, Bike, CheckCircle2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { deviceDb } from "@/drivedb/device";
import type { SaleDetail } from "@/drivedb/reports";
import { inr } from "@/lib/money";
import { dayMonth, hhmm } from "@/lib/dates";
import { ReceiptModal } from "./receipt";
import { card, input, label, errText, type Cfg, type Who } from "./ui";

type Order = { id: string; orderNo: string; customer: string; phone: string | null; address: string; note: string | null; payment: string; status: string; rider: string | null; total: number | null; invoiceNo: string | null; createdAt: string; saleId: string | null; items: { name: string; qty: number; unit: string }[] };
const STATUS: Record<string, string> = { new: "New", packed: "Packed & billed", out: "Out for delivery", delivered: "Delivered", cancelled: "Cancelled" };

/** Home delivery orders: take, pack and bill, send out with a rider, mark delivered (cash on delivery settles the bill). */
export function Orders({ cfg, who, onBilled }: { cfg: Cfg; who: Who; onBilled: () => void }) {
  const toast = useToast();
  const dev = useRef(deviceDb()).current;
  const [rows, setRows] = useState<Order[]>([]);
  const [done, setDone] = useState(false);
  const [adding, setAdding] = useState(false);
  const [receipt, setReceipt] = useState<SaleDetail | null>(null);
  const load = useCallback(() => dev.call("listOrders", cfg.branchId, done).then(setRows), [dev, cfg.branchId, done]);
  useEffect(() => { void load(); }, [load]);

  const act = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast(ok, "green"); void load(); } catch (e) { toast(errText(e), "red"); } };
  const pack = (o: Order) => act(async () => {
    const r = await dev.call("packOrder", { orderId: o.id, userId: who.userId, series: cfg.series, maxDiscountPct: Math.min(who.discCap, cfg.maxDiscountPct) });
    onBilled();
    setReceipt(await dev.call("saleDetail", r.saleId));
  }, `Order ${o.orderNo} packed and billed.`);
  const out = (o: Order) => { const rider = prompt("Who is delivering it?", o.rider ?? ""); if (rider) void act(() => dev.call("dispatchOrder", o.id, rider), `Order ${o.orderNo} is out for delivery with ${rider}.`); };

  return (
    <div className={card}>
      <div className="flex justify-between items-center gap-2 flex-wrap">
        <div className="font-semibold">Home delivery orders</div>
        <div className="flex gap-3 items-center">
          <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={done} onChange={(e) => setDone(e.target.checked)} /> Show delivered and cancelled</label>
          <Button variant="primary" onClick={() => setAdding(true)}><Plus size={16} /> New order</Button>
        </div>
      </div>
      <ul className="text-sm divide-y divide-line">
        {rows.map((o) => (
          <li key={o.id} className="py-2.5 flex flex-col gap-1">
            <div className="flex justify-between gap-2 flex-wrap">
              <span><b>{o.orderNo}</b> · {o.customer}{o.phone ? ` · ${o.phone}` : ""} · <span className="text-muted">{dayMonth(new Date(o.createdAt))} {hhmm(new Date(o.createdAt))}</span></span>
              <span className="text-muted">{STATUS[o.status]}{o.rider ? ` · ${o.rider}` : ""} · {o.payment === "cod" ? "cash on delivery" : `prepaid ${o.payment.toUpperCase()}`}{o.total != null ? ` · ${inr(o.total)}` : ""}</span>
            </div>
            <div className="text-muted">{o.items.map((i) => `${i.qty} ${i.unit === "loose" ? "loose" : "×"} ${i.name}`).join(", ")} · {o.address}{o.note ? ` · ${o.note}` : ""}</div>
            <div className="flex gap-1.5">
              {o.status === "new" && <Button size="sm" variant="primary" onClick={() => pack(o)} aria-label={`Pack ${o.orderNo}`}><Package size={14} /> Pack & bill</Button>}
              {o.status === "packed" && <Button size="sm" onClick={() => out(o)} aria-label={`Send out ${o.orderNo}`}><Bike size={14} /> Out for delivery</Button>}
              {o.status === "out" && <Button size="sm" variant="primary" onClick={() => act(() => dev.call("deliverOrder", o.id, who.userId), o.payment === "cod" ? `Delivered. Cash ${o.total != null ? inr(o.total) : ""} recorded.` : "Delivered.")} aria-label={`Delivered ${o.orderNo}`}><CheckCircle2 size={14} /> Delivered{o.payment === "cod" ? " & cash received" : ""}</Button>}
              {o.status === "new" && <Button size="sm" variant="danger-outline" onClick={() => act(() => dev.call("cancelOrder", o.id), `Order ${o.orderNo} cancelled.`)} aria-label={`Cancel ${o.orderNo}`}><X size={14} /> Cancel</Button>}
              {o.saleId && <Button size="sm" onClick={async () => setReceipt(await dev.call("saleDetail", o.saleId!))}>Bill {o.invoiceNo}</Button>}
            </div>
          </li>
        ))}
        {!rows.length && <li className="py-2 text-muted">{done ? "No orders yet." : "No open orders."}</li>}
      </ul>
      {adding && <NewOrder cfg={cfg} onClose={() => setAdding(false)} onSaved={(no) => { setAdding(false); toast(`Order ${no} taken.`, "green"); void load(); }} />}
      <ReceiptModal d={receipt} pharmacy={cfg.pharmacy} onClose={() => setReceipt(null)} />
    </div>
  );
}

type Cust = { id: string; name: string; phone: string | null };
type Med = { id: string; name: string; mrpPaise: number; stock: number; packSize: number; allowLoose: number; packUnit: string; looseUnit: string };

function NewOrder({ cfg, onClose, onSaved }: { cfg: Cfg; onClose: () => void; onSaved: (orderNo: string) => void }) {
  const toast = useToast();
  const dev = deviceDb();
  const [custQ, setCustQ] = useState("");
  const [custs, setCusts] = useState<Cust[]>([]);
  const [cust, setCust] = useState<Cust | null>(null);
  const [newName, setNewName] = useState("");
  const [address, setAddress] = useState("");
  const [note, setNote] = useState("");
  const [payment, setPayment] = useState<"cod" | "upi" | "cash">("cod");
  const [q, setQ] = useState("");
  const [meds, setMeds] = useState<Med[]>([]);
  const [items, setItems] = useState<{ med: Med; qty: number }[]>([]);
  useEffect(() => { if (custQ.trim().length < 2) { setCusts([]); return; } const t = setTimeout(() => dev.call("findCustomers", custQ).then(setCusts), 150); return () => clearTimeout(t); }, [custQ, dev]);
  useEffect(() => { if (!q.trim()) { setMeds([]); return; } const t = setTimeout(() => dev.call("search", q, cfg.branchId).then((r) => setMeds(r as Med[])), 120); return () => clearTimeout(t); }, [q, dev, cfg.branchId]);

  const save = async () => {
    try {
      let c = cust;
      if (!c) {
        const phone = custQ.replace(/\D/g, "");
        c = await dev.call("addCustomer", { name: newName, phone: /^[6-9]\d{9}$/.test(phone) ? phone : null });
      }
      const o = await dev.call("createOrder", { branchId: cfg.branchId, series: cfg.series, customerId: c.id, address, note: note || undefined, payment, items: items.map((i) => ({ medicineId: i.med.id, qty: i.qty, unit: "pack" as const })) });
      onSaved(o.orderNo);
    } catch (e) { toast(errText(e), "red"); }
  };
  return (
    <Modal open onClose={onClose} title="New delivery order" width={560}
      footer={<div className="flex gap-2 justify-end"><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={!items.length || address.trim().length < 5 || (!cust && !newName.trim())}>Take order</Button></div>}>
      <div className="flex flex-col gap-3 text-sm">
        {cust ? <div className="flex justify-between"><span>{cust.name} {cust.phone}</span><button className="text-teal cursor-pointer" onClick={() => setCust(null)}>Change</button></div> : (
          <div className="relative flex flex-col gap-2">
            <input value={custQ} onChange={(e) => setCustQ(e.target.value)} placeholder="Customer mobile or name" aria-label="Order customer" className={input} />
            {custs.length > 0 && <ul className="absolute z-10 top-10 left-0 right-0 bg-white border border-line rounded-lg shadow divide-y divide-line">{custs.map((c) => <li key={c.id}><button className="w-full text-left px-3 py-2 hover:bg-page cursor-pointer" onClick={() => { setCust(c); setCusts([]); }}>{c.name} <span className="text-muted">{c.phone}</span></button></li>)}</ul>}
            <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New customer’s name (if not found)" aria-label="New customer name" className={input} />
          </div>
        )}
        <label className={label}>Delivery address<textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2} className="border border-line rounded-lg px-3 py-2 text-sm" aria-label="Delivery address" /></label>
        <div className="grid grid-cols-2 gap-2">
          <label className={label}>Payment<select value={payment} onChange={(e) => setPayment(e.target.value as typeof payment)} className={input} aria-label="Order payment"><option value="cod">Cash on delivery</option><option value="upi">Paid by UPI</option><option value="cash">Paid in cash</option></select></label>
          <label className={label}>Note<input value={note} onChange={(e) => setNote(e.target.value)} className={input} aria-label="Order note" /></label>
        </div>
        <div className="relative">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add medicine" aria-label="Order item" className={input} />
          {meds.length > 0 && <ul className="absolute z-10 left-0 right-0 mt-1 bg-white border border-line rounded-lg shadow divide-y divide-line max-h-56 overflow-auto">{meds.map((m) => <li key={m.id}><button className="w-full text-left px-3 py-2 hover:bg-page cursor-pointer" onClick={() => { setItems((x) => [...x, { med: m, qty: 1 }]); setQ(""); }}>{m.name} <span className="text-muted">· {inr(m.mrpPaise)}</span></button></li>)}</ul>}
        </div>
        {items.map((i, k) => (
          <div key={k} className="flex items-center gap-2">
            <span className="flex-1">{i.med.name}</span>
            <input type="number" min={1} value={i.qty} onChange={(e) => setItems((x) => x.map((y, j) => (j === k ? { ...y, qty: Math.max(1, Number(e.target.value) || 1) } : y)))} className="border border-line rounded-lg px-2 h-8 w-16 text-right" aria-label={`Quantity ${i.med.name}`} />
            <span>{i.med.packUnit}s</span>
            <button onClick={() => setItems((x) => x.filter((_, j) => j !== k))} aria-label="Remove" className="p-1 text-muted hover:text-bad cursor-pointer"><Trash2 size={14} /></button>
          </div>
        ))}
      </div>
    </Modal>
  );
}
