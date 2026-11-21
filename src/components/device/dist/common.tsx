"use client";
import { useEffect, useState } from "react";
import { Plus, Printer, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { deviceDb } from "@/drivedb/device";
import { inr } from "@/lib/money";
import { useT } from "@/lib/i18n-client";
import { input } from "../ui";

export type Chemist = { id: string; name: string; phone: string | null; profile: boolean; balancePaise: number; status: string | null; creditLimitPaise: number };
export type Line = { medicineId: string; name: string; qty: number };
export const newKey = () => "dv-" + Math.random().toString(36).slice(2, 12) + Date.now().toString(36);

/** Search and pick a chemist (only customers with a wholesale profile can be billed). */
export function ChemistPicker({ value, onChange, profileOnly = true }: { value: Chemist | null; onChange: (c: Chemist | null) => void; profileOnly?: boolean }) {
  const t = useT();
  const dev = deviceDb();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<Chemist[]>([]);
  useEffect(() => {
    if (value) return;
    const h = setTimeout(() => { dev.call("distChemists", q).then((r) => setRows(r.filter((c) => !profileOnly || c.profile).slice(0, 8)), () => setRows([])); }, 150);
    return () => clearTimeout(h);
  }, [dev, q, value, profileOnly]);
  if (value) return (
    <div className="flex items-center justify-between gap-2 text-sm border border-line rounded-lg px-3 py-2">
      <span><b>{value.name}</b>{value.phone ? ` · ${value.phone}` : ""} · {t("owes")} {inr(value.balancePaise)}{value.status && value.status !== "active" ? ` · ${t(value.status === "hold" ? "On hold" : "Blocked")}` : ""}</span>
      <Button size="sm" variant="ghost" onClick={() => onChange(null)}>{t("Change")}</Button>
    </div>
  );
  return (
    <div className="flex flex-col gap-1">
      <input className={input} placeholder={t("Search chemist by name or phone")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("Chemist")} />
      {rows.length > 0 && <ul className="border border-line rounded-lg divide-y divide-line text-sm">{rows.map((c) => (
        <li key={c.id}><button className="w-full text-left px-3 py-1.5 hover:bg-page cursor-pointer" onClick={() => onChange(c)}>{c.name}{c.phone ? ` · ${c.phone}` : ""} <span className="text-muted">· {inr(c.balancePaise)}</span></button></li>
      ))}</ul>}
    </div>
  );
}

/** Products on a bill or order: search the wholesale catalogue, set packs, remove. */
export function LineEditor({ branchId, lines, setLines }: { branchId: string; lines: Line[]; setLines: (l: Line[]) => void }) {
  const t = useT();
  const dev = deviceDb();
  const [q, setQ] = useState("");
  const [rows, setRows] = useState<{ id: string; name: string; freePacks: number; ptrPaise: number }[]>([]);
  useEffect(() => {
    if (!q.trim()) return;
    const h = setTimeout(() => { dev.call("distProducts", branchId, q).then((r) => setRows(r.filter((p) => p.wholesale && !p.discontinued).slice(0, 8)), () => setRows([])); }, 150);
    return () => clearTimeout(h);
  }, [dev, branchId, q]);
  const shown = q.trim() ? rows : [];
  const add = (p: { id: string; name: string }) => { if (!lines.some((l) => l.medicineId === p.id)) setLines([...lines, { medicineId: p.id, name: p.name, qty: 1 }]); setQ(""); };
  return (
    <div className="flex flex-col gap-2">
      <input className={input} placeholder={t("Add a product: type its name")} value={q} onChange={(e) => setQ(e.target.value)} aria-label={t("Product")} />
      {shown.length > 0 && <ul className="border border-line rounded-lg divide-y divide-line text-sm">{shown.map((p) => (
        <li key={p.id}><button className="w-full text-left px-3 py-1.5 hover:bg-page cursor-pointer flex justify-between" onClick={() => add(p)}><span><Plus size={13} className="inline -mt-0.5" /> {p.name}</span><span className="text-muted">{inr(p.ptrPaise)} · {t("{n} packs free", { n: p.freePacks })}</span></button></li>
      ))}</ul>}
      {lines.map((l, i) => (
        <div key={l.medicineId} className="flex items-center gap-2 text-sm">
          <span className="flex-1">{l.name}</span>
          <input type="number" min={1} className={`${input} w-24`} value={l.qty} aria-label={t("Packs of {name}", { name: l.name })}
            onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, qty: Math.max(0, Math.floor(Number(e.target.value) || 0)) } : x)))} />
          <Button size="sm" variant="ghost" onClick={() => setLines(lines.filter((_, k) => k !== i))} aria-label={t("Remove {name}", { name: l.name })}><Trash2 size={14} /></Button>
        </div>
      ))}
    </div>
  );
}

/** A wholesale invoice to read or print. */
export function InvoiceModal({ id, onClose }: { id: string | null; onClose: () => void }) {
  const t = useT();
  const dev = deviceDb();
  const [v, setV] = useState<unknown>(null);
  useEffect(() => { if (id) dev.call("distInvoiceView", id).then(setV, () => setV(null)); }, [dev, id]);
  const inv = v as null | { no: string; date: string; dueDate: string; customerGstin: string | null; placeOfSupply: string | null; igst: number; taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number; roundOffPaise: number; totalPaise: number;
    lines: { id: string; name: string; hsn: string; batchNo: string; expiryDate: string; qty: number; freeQty: number; ratePaise: number; discPaise: number; taxablePaise: number; gstRate: number; taxPaise: number }[]; cancelled: { reason: string } | null };
  return (
    <Modal open={!!id} onClose={onClose} width={760} title={inv ? t("Tax invoice {no}", { no: inv.no }) : t("Invoice")}
      footer={<Button onClick={() => window.print()}><Printer size={14} /> {t("Print")}</Button>}>
      {inv && <div className="text-sm flex flex-col gap-2 print-area">
        <div className="text-muted">{t("Date")} {inv.date} · {t("Due")} {inv.dueDate}{inv.customerGstin ? ` · GSTIN ${inv.customerGstin}` : ""}{inv.placeOfSupply ? ` · ${t("Place of supply")} ${inv.placeOfSupply}` : ""}</div>
        {inv.cancelled && <div className="text-bad font-medium">{t("Cancelled: {reason}", { reason: inv.cancelled.reason })}</div>}
        <table className="w-full text-[12.5px]"><thead><tr className="text-muted text-left"><th>{t("Product")}</th><th>HSN</th><th>{t("Batch")}</th><th className="text-right">{t("Packs")}</th><th className="text-right">{t("Free")}</th><th className="text-right">{t("Rate")}</th><th className="text-right">{t("Taxable")}</th><th className="text-right">GST</th></tr></thead>
          <tbody>{inv.lines.map((l) => <tr key={l.id} className="border-t border-line"><td>{l.name}</td><td>{l.hsn}</td><td>{l.batchNo} · {l.expiryDate.slice(0, 7)}</td><td className="text-right">{l.qty}</td><td className="text-right">{l.freeQty}</td><td className="text-right">{inr(l.ratePaise)}</td><td className="text-right">{inr(l.taxablePaise)}</td><td className="text-right">{l.gstRate}% · {inr(l.taxPaise)}</td></tr>)}</tbody></table>
        <div className="self-end text-right">
          <div>{t("Taxable")} {inr(inv.taxablePaise)}</div>
          {inv.igst ? <div>IGST {inr(inv.igstPaise)}</div> : <div>CGST {inr(inv.cgstPaise)} · SGST {inr(inv.sgstPaise)}</div>}
          <div>{t("Round off")} {inr(inv.roundOffPaise)}</div>
          <div className="font-semibold text-base">{t("Total")} {inr(inv.totalPaise)}</div>
        </div>
      </div>}
    </Modal>
  );
}
