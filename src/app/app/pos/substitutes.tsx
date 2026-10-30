"use client";
import { useEffect, useRef, useState } from "react";
import { Replace } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Segmented } from "@/components/ui/segmented";
import { inr } from "@/lib/money";
import type { SaleMedicine, substitutesForSale } from "@/domain/sales/service";
import { substitutesAction } from "./catalog-actions";

type Subs = Awaited<ReturnType<typeof substitutesForSale>>;

/** Same-composition brands with this branch's stock. ↑↓ to move, Enter to add, Tab switches price/margin order. */
export function SubstitutesPanel({ medicine, reason, onAdd, onClose }: { medicine: { id: string; name: string } | null; reason?: string; onAdd: (m: SaleMedicine) => void; onClose: () => void }) {
  const [sort, setSort] = useState<"price" | "margin">("price");
  const [data, setData] = useState<Subs | null>(null);
  const [hl, setHl] = useState(0);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!medicine) return;
    let live = true;
    setData(null); setHl(0);
    substitutesAction(medicine.id, sort).then((d) => { if (live) setData(d); }, () => live && setData({ of: null, rows: [] }));
    return () => { live = false; };
  }, [medicine, sort]);
  useEffect(() => { if (medicine) setTimeout(() => box.current?.focus(), 30); }, [medicine]);
  if (!medicine) return null;
  const rows = data?.rows ?? [];
  const pick = (i: number) => { const r = rows[i]; if (r?.inStock) { onAdd(r.med); onClose(); } };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") { e.preventDefault(); setHl((h) => Math.min(h + 1, rows.length - 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setHl((h) => Math.max(h - 1, 0)); }
    else if (e.key === "Enter") { e.preventDefault(); pick(hl); }
    else if (e.key === "Tab") { e.preventDefault(); setSort((s) => (s === "price" ? "margin" : "price")); }
  };
  return (
    <Modal open onClose={onClose} width={640} title={<span className="flex items-center gap-2"><Replace size={17} />Substitutes for {medicine.name}</span>}
      sub={<>{reason ? <span className="text-bad">{reason} </span> : null}{data?.of ? `Same composition: ${data.of.composition}` : "Loading…"}</>}>
      <div ref={box} tabIndex={-1} onKeyDown={onKey} className="flex flex-col gap-2.5 outline-none">
        <Segmented value={sort} onChange={(v) => setSort(v as "price" | "margin")} className="self-start bg-[#EEF0F2]" options={[{ value: "price", label: "Cheapest per unit" }, { value: "margin", label: "Best margin" }]} />
        {data && !rows.length ? <div className="text-[13.5px] text-muted py-3">{data.of ? "No other brand with this composition in the catalogue. Add compositions under Inventory → Salts." : "This medicine has no composition yet. Add it in Inventory to see substitutes."}</div> : null}
        <div className="border border-line rounded-lg overflow-hidden" role="listbox" aria-label="Substitutes">
          {rows.map((r, i) => (
            <button key={r.id} role="option" aria-selected={i === hl} disabled={!r.inStock} onMouseEnter={() => setHl(i)} onClick={() => pick(i)}
              className="w-full grid grid-cols-[minmax(0,1fr)_auto_auto] gap-3 items-center px-3.5 py-2.5 border-b border-row last:border-0 text-left cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
              style={{ background: i === hl ? "#F0F7F6" : "#fff" }}>
              <span className="flex flex-col min-w-0"><span className="font-semibold text-[14px]">{r.name}</span><span className="text-[12px] text-muted truncate">{r.manufacturer}{r.rack ? ` · rack ${r.rack}` : ""}{r.margin != null ? ` · margin ${r.margin}%` : ""}</span></span>
              <span className="text-[12.5px] font-semibold" style={{ color: r.inStock ? "#1E7F4F" : "#B3261E" }}>{r.inStock ? r.stockText + " in stock" : "Out of stock"}</span>
              <span className="text-right tnum"><span className="font-semibold">{inr(r.mrp)}</span><br /><span className="text-[11.5px] text-faint">{inr(r.perUnit)}/unit</span></span>
            </button>
          ))}
        </div>
        <div className="text-[11.5px] text-faint">↑ ↓ select · Enter add to cart · Tab price/margin · Esc close. Substitute only with the prescriber’s or patient’s consent, as the law and your pharmacy policy require.</div>
      </div>
    </Modal>
  );
}
