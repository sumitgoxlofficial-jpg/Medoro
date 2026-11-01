"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Plus, Pencil } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { deviceDb } from "@/drivedb/device";
import { inr } from "@/lib/money";
import { card, input, label, errText, toPaise, type Cfg } from "./ui";

type Row = { id: string; name: string; generic: string; mrpPaise: number; gstRate: number; packSize: number; packUnit: string; looseUnit: string; reorderLevel: number; rack: string | null; barcode: string | null; schedule: string | null; active: number; stock: number; nextExpiry: string | null; low: boolean };
const qtyText = (r: Row) => (r.packSize > 1 ? `${Math.floor(r.stock / r.packSize)} ${r.packUnit}s${r.stock % r.packSize ? ` + ${r.stock % r.packSize} ${r.looseUnit}` : ""}` : `${r.stock} ${r.packUnit}s`);

/** Stock on this device: search, low-stock flags, nearest expiry; add and edit medicines. */
export function Stock({ cfg, owner, refresh }: { cfg: Cfg; owner: boolean; refresh: number }) {
  const dev = useRef(deviceDb()).current;
  const [q, setQ] = useState("");
  const [lowOnly, setLowOnly] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [edit, setEdit] = useState<Row | "new" | null>(null);
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
                <td className="text-right">{owner && <button onClick={() => setEdit(r)} aria-label={`Edit ${r.name}`} className="p-1 text-muted hover:text-teal cursor-pointer"><Pencil size={14} /></button>}</td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={6} className="py-2 text-muted">Nothing to show.</td></tr>}
          </tbody>
        </table>
      </div>
      {edit && <MedicineForm row={edit === "new" ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); void load(); }} />}
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
