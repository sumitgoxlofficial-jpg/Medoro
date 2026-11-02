"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, IndianRupee, MessageCircle, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { deviceDb } from "@/drivedb/device";
import { inr } from "@/lib/money";
import { card, input, label, errText, toPaise, type Who } from "./ui";
import { dueText, waLink } from "@/drivedb/share";
import type { Pharmacy } from "@/drivedb/seed";
import { StoreUpdates } from "./store-updates";

type C = { id: string; name: string; phone: string | null; gstin: string | null; creditLimitPaise: number; balancePaise: number; offers: boolean };

/** Customers on this device: add, see what each owes, record money received. */
export function Customers({ who, refresh, pharmacy }: { who: Who; refresh: number; pharmacy: Pharmacy | null }) {
  const toast = useToast();
  const dev = useRef(deviceDb()).current;
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<C[]>([]);
  const [adding, setAdding] = useState(false);
  const [pay, setPay] = useState<C | null>(null);
  const [linking, setLinking] = useState<string | null>(null);
  const load = useCallback(() => dev.call("customerList", q).then(setRows), [dev, q]);
  /** A payment link for what the customer owes, sent on WhatsApp (or copied when there's no mobile number). */
  const payLink = async (c: C) => {
    if (!who.payLink) return;
    setLinking(c.id);
    try {
      const r = await who.payLink({ customerId: c.id, customerName: c.name, phone: c.phone, amountPaise: c.balancePaise, label: `Dues at ${pharmacy?.tradeName || pharmacy?.name || "the pharmacy"}` });
      if (!r.ok) { toast(r.error, "red"); return; }
      const wa = waLink(c.phone, dueText(c.name, c.balancePaise, pharmacy, r.data.url));
      if (wa) window.open(wa, "_blank", "noopener");
      else { await navigator.clipboard.writeText(r.data.url).catch(() => {}); toast(`Payment link copied: ${r.data.url}`, "green"); }
    } finally { setLinking(null); }
  };
  useEffect(() => { const t = setTimeout(load, 120); return () => clearTimeout(t); }, [load, refresh]);
  /** Records the customer's yes or no to offers on WhatsApp (with who recorded it, when and how). */
  const setOffers = async (c: C, granted: boolean) => {
    try {
      await dev.call("setOffersConsent", { customerId: c.id, granted, userId: who.userId, method: granted ? "Agreed at the counter" : "Asked to stop at the counter" });
      void load();
    } catch (e) { toast(errText(e), "red"); }
  };
  return (
    <div className="flex flex-col gap-4">
    {who.owner && who.whatsapp && <StoreUpdates who={who} refresh={refresh} />}
    <div className={card}>
      <div className="flex gap-2 flex-wrap">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or mobile" aria-label="Search customers" className={`${input} flex-1 min-w-[220px]`} />
        <Button onClick={() => setAdding(true)}><Plus size={16} /> Add customer</Button>
      </div>
      <ul className="text-sm divide-y divide-line">
        {rows.map((c) => (
          <li key={c.id} className="py-2 flex justify-between items-center gap-2 flex-wrap">
            <span>{c.name} <span className="text-muted">{c.phone ?? ""}{c.gstin ? ` · GSTIN ${c.gstin}` : ""}{c.creditLimitPaise ? ` · limit ${inr(c.creditLimitPaise)}` : ""}</span>
              {c.phone && <label className="ml-2 inline-flex items-center gap-1 text-xs text-muted" title="The customer agreed to receive offers and store updates on WhatsApp. Ask them first; untick if they say no or stop.">
                <input type="checkbox" checked={c.offers} onChange={(e) => void setOffers(c, e.target.checked)} aria-label={`${c.name} agrees to offers on WhatsApp`} /> Offers on WhatsApp
              </label>}
            </span>
            <span className="flex items-center gap-2">
              {c.balancePaise ? <span className="text-bad tabular-nums">owes {inr(c.balancePaise)}</span> : <span className="text-muted">nothing due</span>}
              {c.balancePaise > 0 && waLink(c.phone, "") && <Button size="sm" onClick={() => window.open(waLink(c.phone, dueText(c.name, c.balancePaise, pharmacy))!, "_blank", "noopener")} aria-label={`Remind ${c.name}`}><MessageCircle size={14} /> Remind</Button>}
              {c.balancePaise >= 100 && who.payLink && <Button size="sm" onClick={() => payLink(c)} disabled={linking === c.id} aria-label={`Payment link for ${c.name}`}><Link2 size={14} /> {linking === c.id ? "Making link…" : "Pay link"}</Button>}
              {c.balancePaise > 0 && <Button size="sm" onClick={() => setPay(c)} aria-label={`Receive from ${c.name}`}><IndianRupee size={14} /> Receive</Button>}
            </span>
          </li>
        ))}
        {!rows.length && <li className="py-2 text-muted">No customers{q ? " match" : " yet"}.</li>}
      </ul>
      {adding && <AddCustomer who={who} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void load(); }} />}
      {pay && <Receive c={pay} who={who} onClose={() => setPay(null)} onSaved={(left) => { toast(`Received. ${pay.name} now owes ${inr(left)}.`, "green"); setPay(null); void load(); }} />}
    </div>
    </div>
  );
}

function AddCustomer({ who, onClose, onSaved }: { who: Who; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const dev = deviceDb();
  const [f, setF] = useState({ name: "", phone: "", gstin: "", limit: "", offers: false });
  const save = async () => {
    try {
      const c = await dev.call("addCustomer", { name: f.name, phone: f.phone || null, gstin: f.gstin || null, creditLimitPaise: who.canCredit ? toPaise(f.limit) : 0 });
      if (f.offers && f.phone) await dev.call("setOffersConsent", { customerId: c.id, granted: true, userId: who.userId, method: "Agreed at the counter" });
      onSaved();
    }
    catch (e) { toast(errText(e), "red"); }
  };
  return (
    <Modal open onClose={onClose} title="Add customer" width={440} footer={<div className="flex gap-2 justify-end"><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={!f.name.trim()}>Save</Button></div>}>
      <div className="flex flex-col gap-3">
        <label className={label}>Name<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} className={input} aria-label="Customer name" /></label>
        <label className={label}>Mobile<input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} inputMode="numeric" className={input} aria-label="Mobile" /></label>
        <label className={label}>GSTIN (businesses)<input value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value })} className={input} aria-label="GSTIN" /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.offers} disabled={!f.phone} onChange={(e) => setF({ ...f, offers: e.target.checked })} /> Agrees to offers and store updates on WhatsApp (ask first)</label>
        {who.canCredit && <label className={label}>Credit limit (₹)<input value={f.limit} onChange={(e) => setF({ ...f, limit: e.target.value })} inputMode="decimal" className={input} aria-label="Credit limit" /></label>}
      </div>
    </Modal>
  );
}

function Receive({ c, who, onClose, onSaved }: { c: C; who: Who; onClose: () => void; onSaved: (left: number) => void }) {
  const toast = useToast();
  const dev = deviceDb();
  const [amt, setAmt] = useState((c.balancePaise / 100).toFixed(2));
  const [mode, setMode] = useState<"cash" | "upi" | "card">("cash");
  const save = async () => {
    try { const r = await dev.call("receivePayment", { customerId: c.id, amountPaise: toPaise(amt), mode, userId: who.userId }); onSaved(r.balancePaise); }
    catch (e) { toast(errText(e), "red"); }
  };
  return (
    <Modal open onClose={onClose} title={`Receive from ${c.name}`} sub={`Owes ${inr(c.balancePaise)}`} width={400} footer={<div className="flex gap-2 justify-end"><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save}>Save</Button></div>}>
      <div className="flex flex-col gap-3">
        <label className={label}>Amount (₹)<input value={amt} onChange={(e) => setAmt(e.target.value)} inputMode="decimal" className={input} aria-label="Amount" /></label>
        <label className={label}>Mode<select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} className={input}><option value="cash">Cash</option><option value="upi">UPI</option><option value="card">Card</option></select></label>
      </div>
    </Modal>
  );
}
