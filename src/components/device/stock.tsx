"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Pencil, Boxes } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { deviceDb } from "@/drivedb/device";
import { inr } from "@/lib/money";
import { card, input, label, errText, toPaise, type Cfg } from "./ui";

type Row = { id: string; name: string; generic: string; mrpPaise: number; gstRate: number; packSize: number; packUnit: string; looseUnit: string; reorderLevel: number; rack: string | null; barcode: string | null; schedule: string | null; active: number; stock: number; nextExpiry: string | null; low: boolean };
const qtyText = (r: Row) => (r.packSize > 1 ? `${Math.floor(r.stock / r.packSize)} ${r.packUnit}s${r.stock % r.packSize ? ` + ${r.stock % r.packSize} ${r.looseUnit}` : ""}` : `${r.stock} ${r.packUnit}s`);

/** Stock on this device: search, low-stock flags, nearest expiry; add and edit medicines. */
export function Stock({ cfg, owner, userId, refresh }: { cfg: Cfg; owner: boolean; userId: string; refresh: number }) {
  const dev = useRef(deviceDb()).current;
  const [q, setQ] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [edit, setEdit] = useState<Row | "new" | null>(null);
  const [batches, setBatches] = useState<Row | null>(null);
  const load = useCallback(() => dev.call("stockList", cfg.branchId, q).then((r) => setRows(r as Row[])), [dev, cfg.branchId, q]);
  useEffect(() => { const t = setTimeout(load, 120); return () => clearTimeout(t); }, [load, refresh]);
  const shown = lowOnly ? rows.filter((r) => r.low) : rows;
  return (
    <div className={card}>
      <div className="flex gap-2 flex-wrap items-center">
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search medicine, generic or barcode" aria-label="Search stock" className={`${input} flex-1 min-w-[220px]`} />
        <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={lowOnly} onChange={(e) => setLowOnly(e.target.checked)} /> Low stock only</label>
        {owner && <Button onClick={() => setEdit("new")}><Plus size={16} /> Add medicine</Button>}
      </div>
      <div className="overflow-auto">
        <table className="text-sm w-full">
          <thead><tr className="text-left text-muted"><th className="font-medium py-1">Medicine</th><th className="font-medium">Stock</th><th className="font-medium">Next expiry</th><th className="font-medium text-right">MRP</th><th className="font-medium">Rack</th><th /></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className={`border-t border-line ${r.active ? "" : "opacity-50"}`}>
                <td className="py-1.5">{r.name}{r.schedule ? <span className="text-bad"> · {r.schedule}</span> : null}<div className="text-xs text-muted">{r.generic}</div></td>
                <td className={r.low ? "text-bad font-medium" : ""}>{qtyText(r)}{r.low ? " · low" : ""}</td>
                <td>{r.nextExpiry ?? "—"}</td>
                <td className="text-right tabular-nums">{inr(r.mrpPaise)}</td>
                <td>{r.rack ?? ""}</td>
                <td className="text-right whitespace-nowrap">
                  {owner && <button onClick={() => setBatches(r)} aria-label={`Batches of ${r.name}`} className="p-1 text-muted hover:text-teal cursor-pointer"><Boxes size={14} /></button>}
                  {owner && <button onClick={() => setEdit(r)} aria-label={`Edit ${r.name}`} className="p-1 text-muted hover:text-teal cursor-pointer"><Pencil size={14} /></button>}
                </td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={6} className="py-2 text-muted">Nothing to show.</td></tr>}
          </tbody>
        </table>
      </div>
      {edit && <MedicineForm row={edit === "new" ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void load(); }} />}
      {batches && <BatchPanel med={batches} cfg={cfg} userId={userId} onClose={() => { setBatches(null); void load(); }} />}
    </div>
  );
}

function MedicineForm({ row, onClose, onSaved }: { row: Row | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const dev = deviceDb();
  const [f, setF] = useState({
    name: row?.name ?? "", generic: row?.generic ?? "", mrp: row ? (row.mrpPaise / 100).toFixed(2) : "", gstRate: String(row?.gstRate ?? 12),
    packSize: String(row?.packSize ?? 1), packUnit: row?.packUnit ?? "strip", looseUnit: row?.looseUnit ?? "tab", allowLoose: false,
    reorderLevel: String(row?.reorderLevel ?? 0), rack: row?.rack ?? "", barcode: row?.barcode ?? "", schedule: row?.schedule ?? "", active: row ? !!row.active : true,
  });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });
  const save = async () => {
    try {
      const common = { mrpPaise: toPaise(f.mrp), gstRate: Number(f.gstRate) as 0 | 5 | 12 | 18 | 28, reorderLevel: Number(f.reorderLevel) || 0, rack: f.rack || null, barcode: f.barcode || null, schedule: f.schedule || null };
      if (row) await dev.call("updateMedicine", row.id, { ...common, name: f.name, active: f.active });
      else await dev.call("addMedicine", { ...common, name: f.name, generic: f.generic, packSize: Number(f.packSize) || 1, packUnit: f.packUnit, looseUnit: f.looseUnit, allowLoose: f.allowLoose });
      toast(row ? "Medicine updated." : "Medicine added. Add its stock under Purchases.", "green");
      onSaved();
    } catch (e) { toast(errText(e), "red"); }
  };
  return (
    <Modal open onClose={onClose} title={row ? `Edit ${row.name}` : "Add medicine"} width={520}
      footer={<div className="flex gap-2 justify-end"><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={!f.name.trim() || !toPaise(f.mrp)}>Save</Button></div>}>
      <div className="grid grid-cols-2 gap-3">
        <label className={`${label} col-span-2`}>Name<input value={f.name} onChange={set("name")} className={input} /></label>
        {!row && <label className={`${label} col-span-2`}>Generic / salt<input value={f.generic} onChange={set("generic")} className={input} /></label>}
        <label className={label}>MRP per pack (₹)<input value={f.mrp} onChange={set("mrp")} inputMode="decimal" className={input} /></label>
        <label className={label}>GST %<select value={f.gstRate} onChange={set("gstRate")} className={input}>{[0, 5, 12, 18, 28].map((g) => <option key={g} value={g}>{g}</option>)}</select></label>
        {!row && <>
          <label className={label}>Units in a pack<input value={f.packSize} onChange={set("packSize")} inputMode="numeric" className={input} /></label>
          <label className={label}>Pack is a<input value={f.packUnit} onChange={set("packUnit")} className={input} /></label>
          <label className={label}>Loose unit<input value={f.looseUnit} onChange={set("looseUnit")} className={input} /></label>
          <label className="flex items-center gap-2 text-sm mt-5"><input type="checkbox" checked={f.allowLoose} onChange={set("allowLoose")} /> Sell loose</label>
        </>}
        <label className={label}>Reorder at (packs)<input value={f.reorderLevel} onChange={set("reorderLevel")} inputMode="numeric" className={input} /></label>
        <label className={label}>Rack<input value={f.rack} onChange={set("rack")} className={input} /></label>
        <label className={label}>Barcode<input value={f.barcode} onChange={set("barcode")} className={input} /></label>
        <label className={label}>Schedule<select value={f.schedule} onChange={set("schedule")} className={input}><option value="">None</option>{["H", "H1", "X", "G", "NDPS"].map((s) => <option key={s}>{s}</option>)}</select></label>
        {row && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={f.active} onChange={set("active")} /> In use (untick to hide from billing)</label>}
      </div>
    </Modal>
  );
}

type BatchRow = { id: string; batchNo: string; expiryDate: string; qtyAvailable: number; status: string };
const REASONS = [["damaged", "Damaged / broken"], ["expired", "Expired"], ["lost", "Lost / missing"], ["sample", "Given as sample"], ["found", "Found (add back)"]] as const;

/** One medicine's batches: correct stock with a reason, count it, block or release a batch. */
function BatchPanel({ med, cfg, userId, onClose }: { med: Row; cfg: Cfg; userId: string; onClose: () => void }) {
  const toast = useToast();
  const dev = deviceDb();
  const [rows, setRows] = useState<BatchRow[]>([]);
  const [adj, setAdj] = useState<Record<string, { qty: string; reason: string }>>({});
  const [count, setCount] = useState<Record<string, string>>({});
  const load = useCallback(() => dev.call("batchesFor", med.id, cfg.branchId).then((r) => setRows(r as BatchRow[])), [dev, med.id, cfg.branchId]);
  useEffect(() => { void load(); }, [load]);
  const unit = med.packSize > 1 ? med.looseUnit : med.packUnit;
  const doAdjust = async (b: BatchRow) => {
    const a = adj[b.id] ?? { qty: "", reason: "damaged" };
    const n = Math.abs(Number(a.qty) || 0);
    if (!n) return;
    try {
      const r = await dev.call("adjustStock", { branchId: cfg.branchId, batchId: b.id, userId, qty: a.reason === "found" ? n : -n, reason: a.reason as "damaged" });
      toast(`Batch ${b.batchNo}: now ${r.qtyAvailable} ${unit}.`, "green"); setAdj({ ...adj, [b.id]: { qty: "", reason: a.reason } }); void load();
    } catch (e) { toast(errText(e), "red"); }
  };
  const doCount = async () => {
    const counts = Object.entries(count).filter(([, v]) => v !== "").map(([batchId, v]) => ({ batchId, counted: Math.max(0, Math.floor(Number(v) || 0)) }));
    if (!counts.length) return;
    try {
      const r = await dev.call("recordCount", { branchId: cfg.branchId, userId, counts });
      const off = r.diffs.filter((d) => d.diff);
      toast(off.length ? `Count saved: ${off.length} batch(es) corrected.` : "Count saved: everything matched.", "green"); setCount({}); void load();
    } catch (e) { toast(errText(e), "red"); }
  };
  const status = async (b: BatchRow, s: "ok" | "quarantine" | "recalled") => {
    try { await dev.call("setBatchStatus", b.id, s); toast(s === "ok" ? `Batch ${b.batchNo} can be sold again.` : `Batch ${b.batchNo} is blocked from sale.`, "green"); void load(); } catch (e) { toast(errText(e), "red"); }
  };
  return (
    <Modal open onClose={onClose} title={`Batches of ${med.name}`} sub={`Quantities in ${unit}s`} width={760}
      footer={<div className="flex gap-2 justify-between w-full"><Button onClick={doCount} disabled={!Object.values(count).some((v) => v !== "")}>Save stock count</Button><Button onClick={onClose}>Close</Button></div>}>
      <table className="text-sm w-full">
        <thead><tr className="text-left text-muted text-xs"><th className="font-medium py-1">Batch</th><th className="font-medium">Expiry</th><th className="font-medium text-right">Stock</th><th className="font-medium">Status</th><th className="font-medium">Correct stock</th><th className="font-medium">Counted</th></tr></thead>
        <tbody>
          {rows.map((b) => {
            const a = adj[b.id] ?? { qty: "", reason: "damaged" };
            return (
              <tr key={b.id} className="border-t border-line align-middle">
                <td className="py-1.5">{b.batchNo}</td>
                <td>{b.expiryDate}</td>
                <td className={`text-right tabular-nums ${b.qtyAvailable < 0 ? "text-bad" : ""}`}>{b.qtyAvailable}</td>
                <td>
                  <select value={b.status} onChange={(e) => status(b, e.target.value as "ok")} className="border border-line rounded-md h-8 px-1 text-xs" aria-label={`Status of ${b.batchNo}`}>
                    <option value="ok">OK to sell</option><option value="quarantine">Quarantine</option><option value="recalled">Recalled</option>
                  </select>
                </td>
                <td>
                  <span className="flex gap-1">
                    <select value={a.reason} onChange={(e) => setAdj({ ...adj, [b.id]: { ...a, reason: e.target.value } })} className="border border-line rounded-md h-8 px-1 text-xs" aria-label={`Reason for ${b.batchNo}`}>{REASONS.map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select>
                    <input value={a.qty} onChange={(e) => setAdj({ ...adj, [b.id]: { ...a, qty: e.target.value.replace(/\D/g, "") } })} inputMode="numeric" placeholder="qty" className="border border-line rounded-md h-8 px-2 w-16 text-xs" aria-label={`Quantity for ${b.batchNo}`} />
                    <Button size="sm" onClick={() => doAdjust(b)} disabled={!a.qty}>Save</Button>
                  </span>
                </td>
                <td><input value={count[b.id] ?? ""} onChange={(e) => setCount({ ...count, [b.id]: e.target.value.replace(/\D/g, "") })} inputMode="numeric" placeholder={String(b.qtyAvailable)} className="border border-line rounded-md h-8 px-2 w-20 text-xs" aria-label={`Counted ${b.batchNo}`} /></td>
              </tr>
            );
          })}
          {!rows.length && <tr><td colSpan={6} className="py-2 text-muted">No batches in this branch.</td></tr>}
        </tbody>
      </table>
    </Modal>
  );
}
