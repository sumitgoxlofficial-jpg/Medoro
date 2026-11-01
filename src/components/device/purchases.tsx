"use client";
import { useEffect, useRef, useState } from "react";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { deviceDb } from "@/drivedb/device";
import { inr } from "@/lib/money";
import { todayISO } from "@/lib/dates";
import { card, input, label, errText, toPaise, type Cfg, type Who } from "./ui";

type Sup = { id: string; name: string; gstin: string | null };
type Med = { id: string; name: string; mrpPaise: number; gstRate: number; packUnit: string };
type L = { med: Med; batchNo: string; expiry: string; packs: string; free: string; rate: string; mrp: string };

/** Stock in: enter a supplier's bill line by line; stock goes up when it's saved. */
export function Purchases({ cfg, who, onSaved }: { cfg: Cfg; who: Who; onSaved: () => void }) {
  const toast = useToast();
  const dev = useRef(deviceDb()).current;
  const [sups, setSups] = useState<Sup[]>([]);
  const [supplierId, setSupplierId] = useState("");
  const [newSup, setNewSup] = useState("");
  const [billNo, setBillNo] = useState("");
  const [billDate, setBillDate] = useState(todayISO());
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Med[]>([]);
  const [lines, setLines] = useState<L[]>([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => { dev.call("supplierList").then(setSups); }, [dev]);
  useEffect(() => {
    if (!q.trim()) { setFound([]); return; }
    const t = setTimeout(() => dev.call("search", q, cfg.branchId).then((r) => setFound(r as Med[])), 120);
    return () => clearTimeout(t);
  }, [q, dev, cfg.branchId]);

  const addSupplier = async () => {
    try { const s = await dev.call("addSupplier", { name: newSup }); setSups((x) => [...x, s].sort((a, b) => a.name.localeCompare(b.name))); setSupplierId(s.id); setNewSup(""); }
    catch (e) { toast(errText(e), "red"); }
  };
  const setLine = (i: number, k: keyof L, v: string) => setLines((ls) => ls.map((l, j) => (j === i ? { ...l, [k]: v } : l)));
  const total = lines.reduce((n, l) => { const tb = toPaise(l.rate) * (Number(l.packs) || 0); return n + tb + Math.round((tb * l.med.gstRate) / 100); }, 0);

  const save = async () => {
    setBusy(true);
    try {
      const r = await dev.call("recordPurchase", {
        branchId: cfg.branchId, supplierId, billNo, billDate, userId: who.userId,
        lines: lines.map((l) => ({ medicineId: l.med.id, batchNo: l.batchNo, expiryDate: l.expiry.length === 7 ? `${l.expiry}-28` : l.expiry, packs: Number(l.packs) || 0, freePacks: Number(l.free) || 0, costPaise: toPaise(l.rate), mrpPaise: toPaise(l.mrp) })),
      });
      toast(`Bill ${billNo} entered: ${lines.length} item(s), ${inr(r.totalPaise)} incl. GST. Stock updated.`, "green");
      setLines([]); setBillNo(""); onSaved();
    } catch (e) { toast(errText(e), "red"); }
    setBusy(false);
  };

  return (
    <div className={card}>
      <div className="font-semibold">Enter a supplier’s bill</div>
      <div className="grid gap-3 md:grid-cols-4">
        <label className={label}>Supplier
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)} className={input} aria-label="Supplier">
            <option value="">Choose…</option>{sups.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        <label className={label}>Or add a supplier
          <span className="flex gap-1"><input value={newSup} onChange={(e) => setNewSup(e.target.value)} placeholder="Supplier name" className={input} aria-label="New supplier" /><Button onClick={addSupplier} disabled={!newSup.trim()}>Add</Button></span>
        </label>
        <label className={label}>Bill no.<input value={billNo} onChange={(e) => setBillNo(e.target.value)} className={input} aria-label="Bill number" /></label>
        <label className={label}>Bill date<input type="date" value={billDate} max={todayISO()} onChange={(e) => setBillDate(e.target.value)} className={input} aria-label="Bill date" /></label>
      </div>
      <div className="relative">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Add an item: search medicine" aria-label="Add item" className={input} />
        {found.length > 0 && (
          <ul className="absolute z-10 left-0 right-0 mt-1 bg-white border border-line rounded-lg shadow divide-y divide-line max-h-64 overflow-auto">
            {found.map((m) => <li key={m.id}><button className="w-full text-left px-3 py-2 hover:bg-page cursor-pointer text-sm" onClick={() => { setLines((ls) => [...ls, { med: m, batchNo: "", expiry: "", packs: "", free: "", rate: "", mrp: (m.mrpPaise / 100).toFixed(2) }]); setQ(""); }}>{m.name} <span className="text-muted">· MRP {inr(m.mrpPaise)} · GST {m.gstRate}%</span></button></li>)}
          </ul>
        )}
      </div>
      {lines.length > 0 && (
        <div className="overflow-auto">
          <table className="text-sm w-full">
            <thead><tr className="text-left text-muted text-xs"><th className="font-medium py-1">Item</th><th className="font-medium">Batch</th><th className="font-medium">Expiry</th><th className="font-medium">Packs</th><th className="font-medium">Free</th><th className="font-medium">Rate/pack (₹, before GST)</th><th className="font-medium">MRP (₹)</th><th /></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="py-1 pr-2">{l.med.name}</td>
                  <td><input value={l.batchNo} onChange={(e) => setLine(i, "batchNo", e.target.value)} className={`${input} w-24`} aria-label="Batch" /></td>
                  <td><input type="month" value={l.expiry.slice(0, 7)} onChange={(e) => setLine(i, "expiry", e.target.value)} className={`${input} w-36`} aria-label="Expiry" /></td>
                  <td><input value={l.packs} onChange={(e) => setLine(i, "packs", e.target.value)} inputMode="numeric" className={`${input} w-16`} aria-label="Packs" /></td>
                  <td><input value={l.free} onChange={(e) => setLine(i, "free", e.target.value)} inputMode="numeric" className={`${input} w-14`} aria-label="Free packs" /></td>
                  <td><input value={l.rate} onChange={(e) => setLine(i, "rate", e.target.value)} inputMode="decimal" className={`${input} w-24`} aria-label="Rate" /></td>
                  <td><input value={l.mrp} onChange={(e) => setLine(i, "mrp", e.target.value)} inputMode="decimal" className={`${input} w-24`} aria-label="MRP" /></td>
                  <td><button onClick={() => setLines((ls) => ls.filter((_, j) => j !== i))} aria-label="Remove line" className="p-1 text-muted hover:text-bad cursor-pointer"><Trash2 size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div className="flex justify-between items-center">
        <span className="text-sm">Bill total (incl. GST): <b className="tabular-nums">{inr(total)}</b></span>
        <Button variant="primary" onClick={save} disabled={busy || !supplierId || !billNo.trim() || !lines.length}><Plus size={16} /> {busy ? "Saving…" : "Save bill and add stock"}</Button>
      </div>
    </div>
  );
}
