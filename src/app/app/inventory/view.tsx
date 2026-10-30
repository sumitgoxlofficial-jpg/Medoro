"use client";
import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, Plus, X, Pencil, PackageOpen, Upload, ArrowLeftRight, MoreHorizontal, Printer, FlaskConical } from "lucide-react";
import { ImportDialog } from "@/components/import-dialog";
import { Button } from "@/components/ui/button";
import { Badge, type Tone } from "@/components/ui/badge";
import { Empty } from "@/components/ui/card";
import { Checkbox, Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { Segmented } from "@/components/ui/segmented";
import { useActionToast, useToast } from "@/components/ui/toast";
import { cn } from "@/components/ui/cn";
import { inr } from "@/lib/money";
import { fmtQty, parseQty } from "@/lib/units";
import { dayMonth, monthYear, todayISO } from "@/lib/dates";
import { FORMS, GST_RATES, type MedicineInput, type ReceiveInput } from "@/domain/inventory/contracts";
import type { listInventory, medicineDetail, InvFilter } from "@/domain/inventory/service";
import type { listBranchTransfers } from "@/domain/inventory/adjust";
import { addMedicineAction, adjustAction, editMedicineAction, prepareLabelsAction, quarantineAction, rebuildSaltsAction, receiveBatchAction, requestTransferAction, returnAction, sampleSaltsAction, setRackAction, transferAction, writeOffAction } from "./actions";

type List = Awaited<ReturnType<typeof listInventory>>;
type Detail = NonNullable<Awaited<ReturnType<typeof medicineDetail>>>;
type Transfers = Awaited<ReturnType<typeof listBranchTransfers>>;

const FILTERS: [InvFilter, string][] = [["all", "All"], ["low", "Low stock"], ["rx", "Schedule H/H1"], ["exp", "Expiring ≤ 90 d"]];
const th = "text-left text-[12px] font-medium text-muted px-3.5 py-2.5 border-b border-[#E3E6E9] whitespace-nowrap";
const td = "px-3.5 py-2.5 border-b border-row";

export function InventoryView({ list, detail, q, filter, rack, racks, openAdd, tab, transfers, canEdit, canAdjust, canPurchase }: {
  list: List; detail: Detail | null; q: string; filter: InvFilter; rack: string; racks: string[]; openAdd: boolean; tab: "stock" | "transfers"; transfers: Transfers; canEdit: boolean; canAdjust: boolean; canPurchase: boolean;
}) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [query, setQuery] = useState(q);
  const [modal, setModal] = useState<null | "add" | "edit">(openAdd && canEdit ? "add" : null);
  const [importing, setImporting] = useState(false);
  const [labels, setLabels] = useState<LabelSel | null>(null);
  const [salts, setSalts] = useState(false);

  const nav = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) { if (v) p.set(k, v); else p.delete(k); }
    p.delete("add");
    router.replace(`${path}?${p.toString()}`, { scroll: false });
  };
  useEffect(() => {
    if (query === q) return;
    const t = setTimeout(() => nav({ q: query || null }), 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query]);

  const open = transfers.filter((t) => t.canApprove || t.canReceive).length;
  const tabs = (
    <Segmented value={tab} onChange={(v) => nav({ tab: v === "transfers" ? "transfers" : null, sel: null })} className="self-start bg-[#EEF0F2]"
      options={[{ value: "stock", label: "Stock" }, { value: "transfers", label: `Transfers${open ? ` (${open} to act on)` : ""}` }]} />
  );
  if (tab === "transfers") return <div className="flex flex-col gap-3.5 max-w-[1400px]">{tabs}<TransfersPanel transfers={transfers} /></div>;

  return (
    <div className="flex flex-col gap-3.5 max-w-[1400px]">
      {tabs}
      <div className="flex gap-2.5 flex-wrap items-center">
        <div className="relative flex-1 min-w-[240px] max-w-[420px]">
          <Search size={16} className="absolute left-[11px] top-1/2 -translate-y-1/2 text-fainter" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search brand, salt, manufacturer or barcode" aria-label="Search inventory"
            className="w-full border border-input rounded-lg py-[9px] pr-[11px] pl-[34px] text-[14px] outline-none bg-white focus:border-teal" />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {FILTERS.map(([id, label]) => (
            <button key={id} onClick={() => nav({ filter: id === "all" ? null : id })} className="rounded-full px-3 py-1.5 text-[13px] font-medium cursor-pointer border"
              style={filter === id ? { background: "#0B5E5B", color: "#fff", borderColor: "#0B5E5B" } : { background: "#fff", color: "#3D454D", borderColor: "#CDD2D7" }}>{label}</button>
          ))}
        </div>
        {racks.length ? (
          <select value={rack} onChange={(e) => nav({ rack: e.target.value || null })} aria-label="Filter by rack" className="border border-input rounded-full px-3 py-1.5 text-[13px] bg-white">
            <option value="">All racks</option>
            {racks.map((r) => <option key={r} value={r}>Rack {r}</option>)}
          </select>
        ) : null}
        <div className="ml-auto flex gap-2.5 items-center flex-wrap">
          <span className="text-[12.5px] text-muted">{list.rows.length} of {list.total} medicines</span>
          {canEdit && list.rows.length ? <Button onClick={() => setLabels({ medicineIds: list.rows.slice(0, 200).map((r) => r.id), batchIds: [], title: `${Math.min(list.rows.length, 200)} medicines in this list` })}><Printer size={15} />Labels</Button> : null}
          {canEdit ? <Button onClick={() => setSalts(true)}><FlaskConical size={15} />Salts</Button> : null}
          {canEdit ? <Button onClick={() => setImporting(true)}><Upload size={15} />Import</Button> : null}
          {canEdit ? <Button variant="primary" onClick={() => setModal("add")}><Plus size={16} />Add medicine</Button> : null}
        </div>
      </div>

      <div className="bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] overflow-auto">
        {list.rows.length ? (
          <table className="w-full border-collapse min-w-[860px] text-[14px]">
            <thead><tr className="bg-subtle">
              <th className={th}>Medicine</th><th className={th}>Manufacturer</th><th className={th}>Rack</th><th className={th + " text-right"}>Sellable</th><th className={th + " text-right"}>Reorder</th>
              <th className={th}>Batches</th><th className={th}>Nearest expiry</th><th className={th + " text-right"}>MRP</th><th className={th}>GST</th><th className={th}>Sch.</th>
            </tr></thead>
            <tbody>
              {list.rows.map((r) => (
                <tr key={r.id} onClick={() => nav({ sel: r.id })} className="cursor-pointer hover:bg-[#FAFCFC]" style={{ background: detail?.medicine.id === r.id ? "#F0F7F6" : undefined }}>
                  <td className={td}><div className="font-semibold">{r.name}</div><div className="text-[12px] text-muted">{r.meta}</div></td>
                  <td className={td + " text-ink-2"}>{r.manufacturer}</td>
                  <td className={td + " text-[13px] font-mono"}>{r.rack ?? "—"}</td>
                  <td className={td + " text-right font-semibold tnum"} style={{ color: r.low ? "#B3261E" : "#1F2328" }}>{r.sellableText}</td>
                  <td className={td + " text-right text-muted tnum"}>{r.reorder}</td>
                  <td className={td + " text-[13px]"}>{r.batches}{r.blocked ? <span className="text-warn"> (blocked: {r.blocked})</span> : null}</td>
                  <td className={td + " text-[13px]"} style={{ color: r.nearDays == null ? undefined : r.nearDays <= 30 ? "#B3261E" : r.nearDays <= 90 ? "#94570A" : "#1F2328" }}>{r.nearExpiry ? monthYear(r.nearExpiry) : "—"}</td>
                  <td className={td + " text-right tnum"}>{inr(r.mrp)}</td>
                  <td className={td + " text-[13px]"}>{r.gst}%</td>
                  <td className={td + " text-[13px]"}>{r.schedule ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : list.total ? (
          <Empty icon={Search} title="No medicines match" body="Try a different name, generic or barcode, or clear the filter." />
        ) : (
          <Empty icon={PackageOpen} title="Your catalogue is empty" body="Add each medicine you stock with its MRP, GST rate and reorder level. Then receive batches to make it sellable."
            action={canEdit ? <div className="flex gap-2 justify-center flex-wrap"><Button variant="primary" onClick={() => setModal("add")}><Plus size={16} />Add your first medicine</Button><Button onClick={() => setImporting(true)}><Upload size={15} />Import from Excel or CSV</Button></div> : null} />
        )}
      </div>

      {detail ? <Drawer d={detail} onClose={() => nav({ sel: null })} onEdit={() => setModal("edit")} onLabels={setLabels} onOpen={(id) => nav({ sel: id })} canEdit={canEdit} canAdjust={canAdjust} canPurchase={canPurchase} /> : null}
      <LabelDialog sel={labels} onClose={() => setLabels(null)} />
      <SaltsDialog open={salts} onClose={() => setSalts(false)} />
      <ImportDialog kind="medicines" open={importing} onClose={() => setImporting(false)} />
      <MedicineModal open={modal !== null} edit={modal === "edit" ? detail?.medicine ?? null : null} onClose={() => setModal(null)} onSaved={(id) => { setModal(null); if (id) nav({ sel: id, q: null, filter: null }); }} />
    </div>
  );
}

type LabelSel = { medicineIds: string[]; batchIds: string[]; title: string };

function Drawer({ d, onClose, onEdit, onLabels, onOpen, canEdit, canAdjust, canPurchase }: {
  d: Detail; onClose: () => void; onEdit: () => void; onLabels: (s: LabelSel) => void; onOpen: (id: string) => void; canEdit: boolean; canAdjust: boolean; canPurchase: boolean;
}) {
  const m = d.medicine;
  const toast = useToast();
  const toastR = useActionToast();
  const [pending, start] = useTransition();
  const blank = { batchNo: "", expiry: "", qty: "", unit: "pack" as "pack" | "case", cost: "", mrp: (m.mrp / 100).toFixed(2), supplierId: "", invoiceNo: "" };
  const [rcv, setRcv] = useState(blank);
  const [rack, setRack] = useState(d.branchRack);
  useEffect(() => { setRcv({ ...blank, mrp: (m.mrp / 100).toFixed(2) }); setRack(d.branchRack); }, [m.id, m.mrp, d.branchRack]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);

  const receive = () => start(async () => {
    const r = await receiveBatchAction({ medicineId: m.id, batchNo: rcv.batchNo, expiry: rcv.expiry, qty: rcv.qty, unit: rcv.unit, cost: rcv.cost, mrp: rcv.mrp, supplierId: rcv.supplierId || null, invoiceNo: rcv.invoiceNo } as unknown as ReceiveInput);
    if (!r.ok) return toast(r.error, "red");
    toast(`Batch ${rcv.batchNo.toUpperCase()} received: ${r.data.unitsText}${r.data.grnNo ? " · " + r.data.grnNo : ""}.`, "green");
    setRcv((x) => ({ ...x, batchNo: "", expiry: "", qty: "", cost: "", invoiceNo: "" }));
  });
  const saveRack = () => start(async () => { toastR(await setRackAction(m.id, rack)); });
  const [act, setAct] = useState<Detail["batches"][number] | null>(null);
  const status = (b: Detail["batches"][number]): [string, Tone] =>
    b.status === "quarantine" ? ["Quarantined", "amber"] : b.status !== "ok" ? [b.status[0].toUpperCase() + b.status.slice(1), "red"]
      : b.days <= 0 ? ["Expired · blocked", "red"] : b.qty === 0 ? ["Sold out", "gray"] : b.days <= 60 ? [`${b.days} days left`, "amber"] : ["Sellable", "green"];
  const minMonth = todayISO().slice(0, 7);
  const ri = "border border-input rounded-[7px] px-2.5 py-2 text-[13.5px] outline-none bg-white focus:border-teal w-full";
  const packWord = m.packSize > 1 ? m.packUnit : "pack";

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 bg-[rgba(20,28,32,.3)] z-50" />
      <div role="dialog" aria-label={m.name} className="fixed right-0 top-0 bottom-0 w-[min(620px,100vw)] bg-white z-[51] shadow-[-12px_0_32px_rgba(0,0,0,.15)] flex flex-col">
        <div className="flex items-start gap-3 px-[22px] py-[18px] border-b border-[#E3E6E9]">
          <div className="flex-1 flex flex-col gap-0.5"><div className="text-[18px] font-semibold">{m.name}</div><div className="text-[13px] text-muted">{m.composition || `${m.generic} · ${m.strength}`} · {m.form} · {m.pack}</div></div>
          {canEdit ? <Button size="sm" onClick={() => onLabels({ medicineIds: [m.id], batchIds: [], title: m.name })}><Printer size={13} />Labels</Button> : null}
          {canEdit ? <Button size="sm" onClick={onEdit}><Pencil size={13} />Edit</Button> : null}
          <button onClick={onClose} aria-label="Close" className="p-1.5 text-muted cursor-pointer"><X size={20} /></button>
        </div>
        <div className="flex-1 overflow-auto px-[22px] py-[18px] flex flex-col gap-[18px]">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-x-4 gap-y-2.5 text-[13px]">
            {[["Manufacturer", m.manufacturer], ["Barcode", m.barcode ?? "—", true], ["HSN · GST", `${m.hsn} · ${m.gstRate}%`], ["MRP", `${inr(m.mrp)} / ${packWord}`], ["Schedule", m.schedule ? "Schedule " + m.schedule : "OTC"],
              ["Sellable · reorder", `${d.sellableText} · ${m.reorderLevel} ${packWord}${m.reorderLevel === 1 ? "" : "s"}`], ["Sales velocity", `${d.velocity.toFixed(1)} ${packWord}s / day (28-day avg)`],
              ["Pack", m.packLabel || "Sold in whole packs"], ["Loose sale", m.allowLoose ? `Yes · ${inr(Math.floor(m.mrp / m.packSize))} / ${m.looseUnit}` : "No"], ["Catalogue rack", m.rack || "—"]].map(([k, v, mono]) => (
              <div key={k as string} className="flex flex-col"><span className="text-muted text-[12px]">{k}</span><span className={mono ? "font-mono" : ""}>{v}</span></div>
            ))}
          </div>

          {canEdit ? (
            <div className="flex items-end gap-2 flex-wrap">
              <label className="flex flex-col gap-1 text-[12px] text-muted">Rack at this branch<input className={ri + " w-[140px] font-mono"} value={rack} onChange={(e) => setRack(e.target.value)} placeholder={m.rack || "e.g. A3"} aria-label="Rack at this branch" /></label>
              <Button size="sm" className="h-9" disabled={pending || rack === d.branchRack} onClick={saveRack}>Save rack</Button>
              <span className="text-[12px] text-faint self-center">{d.branchRack ? "Overrides the catalogue rack here." : "Blank uses the catalogue rack."}</span>
            </div>
          ) : null}

          <div className="flex flex-col gap-2">
            <div className="font-semibold text-[14.5px]">Batches (FEFO order)</div>
            {d.batches.length ? (
              <div className="border border-[#E3E6E9] rounded-lg overflow-hidden">
                {d.batches.map((b) => {
                  const [label, tone] = status(b);
                  return (
                    <div key={b.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-3 items-center px-3 py-2.5 border-b border-row last:border-0 text-[13px]">
                      <div className="flex flex-col min-w-0"><span className="font-mono font-medium">{b.batchNo}</span><span className="text-[12px] text-muted truncate">Exp {monthYear(b.expiry)} · {b.supplier} · cost {inr(b.cost)}{b.mrp !== m.mrp ? ` · MRP ${inr(b.mrp)}` : ""}{b.note ? ` · ${b.note}` : ""}</span></div>
                      <span className="font-semibold tnum">{b.qtyText}</span>
                      <Badge tone={tone}>{label}</Badge>
                      <span className="flex gap-1">
                        {canEdit ? <Button size="sm" onClick={() => onLabels({ medicineIds: [m.id], batchIds: [b.id], title: `${m.name} · ${b.batchNo}` })} aria-label={`Labels for ${b.batchNo}`}><Printer size={13} /></Button> : null}
                        {canAdjust || (canPurchase && b.hasSupplier && b.qty > 0)
                          ? <Button size="sm" disabled={pending} onClick={() => setAct(b)} aria-label={`Actions for ${b.batchNo}`}><MoreHorizontal size={14} />Actions</Button> : null}
                      </span>
                    </div>
                  );
                })}
              </div>
            ) : <div className="text-[13px] text-fainter">No batches at this branch yet.</div>}
          </div>

          <div className="flex flex-col gap-2">
            <div className="flex items-baseline justify-between"><div className="font-semibold text-[14.5px]">Substitutes</div><span className="text-[12px] text-faint">Same composition{m.composition ? `: ${m.composition}` : ""}</span></div>
            {d.substitutes.length ? (
              <div className="border border-[#E3E6E9] rounded-lg overflow-hidden">
                {d.substitutes.map((x) => (
                  <button key={x.id} onClick={() => onOpen(x.id)} className="w-full text-left grid grid-cols-[minmax(0,1fr)_auto_auto] gap-3 items-center px-3 py-2 border-b border-row last:border-0 text-[13px] hover:bg-[#FAFCFC] cursor-pointer">
                    <span className="flex flex-col min-w-0"><span className="font-medium">{x.name}</span><span className="text-[12px] text-muted truncate">{x.manufacturer}{x.rack ? ` · rack ${x.rack}` : ""}{x.margin != null ? ` · margin ${x.margin}%` : ""}</span></span>
                    <span className="tnum" style={{ color: x.inStock ? "#1E7F4F" : "#8A929A" }}>{x.inStock ? x.stockText : "Out of stock"}</span>
                    <span className="tnum text-right">{inr(x.mrp)}<br /><span className="text-[11.5px] text-faint">{inr(x.perUnit)}/unit</span></span>
                  </button>
                ))}
              </div>
            ) : <div className="text-[13px] text-fainter">{m.composition ? "No other brand with this composition in the catalogue." : "Add the composition (salts and strengths) to find substitutes."}</div>}
          </div>

          {canEdit ? (
            <div className="flex flex-col gap-2 p-3.5 bg-[#F7FAFA] border border-[#E3E6E9] rounded-[10px]">
              <div className="font-semibold text-[14.5px]">Receive a batch</div>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-2">
                <input className={ri + " font-mono uppercase"} value={rcv.batchNo} onChange={(e) => setRcv({ ...rcv, batchNo: e.target.value.toUpperCase() })} placeholder="Batch no." aria-label="Batch number" />
                <input className={ri} type="month" min={minMonth} value={rcv.expiry} onChange={(e) => setRcv({ ...rcv, expiry: e.target.value })} aria-label="Expiry month" title="Expiry (month/year on the pack)" />
                <div className="flex gap-1">
                  <input className={ri} value={rcv.qty} onChange={(e) => setRcv({ ...rcv, qty: e.target.value.replace(/\D/g, "") })} placeholder={`Qty (${rcv.unit === "case" ? m.caseUnit : packWord}s)`} inputMode="numeric" aria-label="Quantity" />
                  {m.caseSize > 1 ? <select className={ri + " w-auto"} value={rcv.unit} onChange={(e) => setRcv({ ...rcv, unit: e.target.value as "pack" | "case" })} aria-label="Receive unit"><option value="pack">{packWord}</option><option value="case">{m.caseUnit} ({m.caseSize})</option></select> : null}
                </div>
                <input className={ri} value={rcv.cost} onChange={(e) => setRcv({ ...rcv, cost: e.target.value.replace(/[^\d.]/g, "") })} placeholder={`Cost / ${packWord} ₹ ex-GST`} inputMode="decimal" aria-label="Cost per pack" title="Purchase rate per pack, excluding GST" />
                <input className={ri} value={rcv.mrp} onChange={(e) => setRcv({ ...rcv, mrp: e.target.value.replace(/[^\d.]/g, "") })} placeholder={`MRP / ${packWord} ₹`} inputMode="decimal" aria-label="MRP per pack" title="MRP printed on this batch" />
              </div>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(180px,1fr))] gap-2">
                <select className={ri} value={rcv.supplierId} onChange={(e) => setRcv({ ...rcv, supplierId: e.target.value })} aria-label="Source">
                  <option value="">Opening stock (no supplier bill)</option>
                  {canPurchase ? d.suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>) : null}
                </select>
                {rcv.supplierId ? <input className={ri} value={rcv.invoiceNo} onChange={(e) => setRcv({ ...rcv, invoiceNo: e.target.value })} placeholder="Supplier invoice no." aria-label="Supplier invoice number" /> : null}
              </div>
              <div className="flex items-center gap-3 flex-wrap">
                <Button variant="primary" size="sm" className="h-8 px-3.5" disabled={pending} onClick={receive}>{rcv.supplierId ? "Post GRN" : "Add opening stock"}</Button>
                <span className="text-[12px] text-faint">{rcv.supplierId ? "Posts the GRN, the supplier payable and input GST." : d.suppliers.length || !canPurchase ? "For stock already on your shelves." : "Add suppliers under Suppliers & customers to post GRNs."}{m.packSize > 1 ? ` Stock is kept in ${m.looseUnit}s (${m.packSize} per ${packWord}).` : ""}</span>
              </div>
            </div>
          ) : null}

          <div className="flex flex-col gap-1.5">
            <div className="font-semibold text-[14.5px]">Stock movement ledger</div>
            <div className="text-[12px] text-faint">Append-only. Corrections post as new movements.</div>
            {d.moves.length ? d.moves.map((mv) => (
              <div key={mv.id} className="grid grid-cols-[100px_minmax(0,1fr)_auto] gap-2.5 py-[7px] border-b border-row text-[13px] items-baseline">
                <span className="text-faint text-[12px]">{mv.when}</span>
                <span><strong className="font-semibold capitalize">{mv.type.replace("_", " ")}</strong> <span className="text-muted">· {mv.batchNo} · {mv.ref} · {mv.by}</span></span>
                <span className="font-semibold tnum" style={{ color: mv.qty < 0 ? "#B3261E" : mv.qty > 0 ? "#1E7F4F" : "#5B636B" }}>{mv.qty > 0 ? "+" : ""}{mv.qtyText}</span>
              </div>
            )) : <div className="text-[13px] text-fainter">No movements yet.</div>}
          </div>
        </div>
      </div>
      <BatchActions batch={act} medicine={m} branches={d.branches} canAdjust={canAdjust} canPurchase={canPurchase} onClose={() => setAct(null)} />
    </>
  );
}

const LABEL_SIZES = [["thermal", "Thermal roll · 50 × 25 mm"], ["a4", "A4 sheet · 3 × 10 (63.5 × 25.4 mm)"]] as const;

function LabelDialog({ sel, onClose }: { sel: LabelSel | null; onClose: () => void }) {
  const toast = useToast();
  const [size, setSize] = useState<"thermal" | "a4">("thermal");
  const [copies, setCopies] = useState("1");
  const [pending, start] = useTransition();
  if (!sel) return null;
  const go = () => start(async () => {
    // Items without a barcode get an internal one first, so every label scans at the counter.
    const r = await prepareLabelsAction(sel.medicineIds);
    if (!r.ok) return toast(r.error, "red");
    const p = new URLSearchParams({ size, copies: String(Math.max(1, parseInt(copies) || 1)) });
    if (sel.batchIds.length) p.set("b", sel.batchIds.join(",")); else p.set("m", sel.medicineIds.join(","));
    const w = window.open(`/print/labels?${p.toString()}`, "_blank");
    if (!w) toast("Allow pop-ups to print labels.", "amber"); else w.opener = null;
    if (r.data) toast(`${r.data} item${r.data > 1 ? "s" : ""} got an internal barcode.`, "blue");
    onClose();
  });
  return (
    <Modal open onClose={onClose} width={440} title="Print labels" sub={sel.title}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" disabled={pending} onClick={go}><Printer size={14} />{pending ? "Preparing…" : "Open label sheet"}</Button></>}>
      <Field label="Label size"><Select value={size} onChange={(e) => setSize(e.target.value as "thermal" | "a4")}>{LABEL_SIZES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
      <Field label={sel.batchIds.length ? "Copies" : "Copies per batch"}><Input value={copies} onChange={(e) => setCopies(e.target.value.replace(/\D/g, ""))} inputMode="numeric" /></Field>
      <div className="text-[12px] text-faint">Each label shows name, batch, expiry, MRP and a barcode (EAN-13 for a valid 13-digit code, Code 128 otherwise). Items without a barcode get an internal EAN-13 starting 29.</div>
    </Modal>
  );
}

function SaltsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toastR = useActionToast();
  const [pending, start] = useTransition();
  if (!open) return null;
  const go = (fn: () => Promise<Parameters<typeof toastR>[0]>) => start(async () => { toastR(await fn()); onClose(); });
  return (
    <Modal open onClose={onClose} width={500} title="Salts and substitutes" sub="Medicines with the same composition (salts and strengths, in any order) are offered as substitutes at the counter.">
      <div className="flex flex-col gap-3 text-[13.5px]">
        <div className="flex flex-col gap-1.5 p-3 border border-line rounded-lg">
          <strong>Import sample salts</strong>
          <span className="text-muted">Adds about 60 common Indian brands (Dolo 650, Pan 40, Azithral 500…) with their compositions and pack sizes, and fills the composition of matching brands you already have. Nothing is overwritten and no stock is added. MRPs are indicative: each batch sells at the MRP you enter when receiving it.</span>
          <div><Button variant="primary" disabled={pending} onClick={() => go(sampleSaltsAction)}>Import sample</Button></div>
        </div>
        <div className="flex flex-col gap-1.5 p-3 border border-line rounded-lg">
          <strong>Rebuild composition keys</strong>
          <span className="text-muted">Recomputes every medicine’s composition from its composition field, or from generic + strength, so substitutes match after a bulk import or edits.</span>
          <div><Button disabled={pending} onClick={() => go(rebuildSaltsAction)}>Rebuild keys</Button></div>
        </div>
        <span className="text-[12px] text-faint">To bring your own list, import a spreadsheet with a “Composition” (or “Salt”) column under Import.</span>
      </div>
    </Modal>
  );
}

const ACTIONS = { adjust: "Stock adjustment (+/−)", writeoff: "Write off", return: "Return to supplier (debit note)", transfer: "Transfer to another branch", quarantine: "Quarantine", release: "Release from quarantine" } as const;
type ActionId = keyof typeof ACTIONS;

function BatchActions({ batch: b, medicine: m, branches, canAdjust, canPurchase, onClose }: {
  batch: Detail["batches"][number] | null; medicine: Detail["medicine"]; branches: Detail["branches"]; canAdjust: boolean; canPurchase: boolean; onClose: () => void;
}) {
  const toast = useToast();
  const [pending, start] = useTransition();
  const [f, setF] = useState({ action: "adjust" as ActionId, dir: "remove" as "add" | "remove", qty: "", reason: "", kind: "Damaged", to: "" });
  const [err, setErr] = useState("");
  const avail: ActionId[] = !b ? [] : (Object.keys(ACTIONS) as ActionId[]).filter((a) =>
    a === "adjust" ? canAdjust
      : a === "writeoff" ? canAdjust && b.qty > 0
        : a === "return" ? canPurchase && b.hasSupplier && b.qty > 0
          : a === "transfer" ? canAdjust && b.status === "ok" && b.days > 0 && b.qty > 0 && branches.length > 0
            : a === "quarantine" ? canAdjust && b.status === "ok"
              : canAdjust && b.status === "quarantine");
  useEffect(() => { if (b) { setF({ action: avail[0] ?? "adjust", dir: "remove", qty: "", reason: "", kind: b.days <= 0 ? "Expired" : "Damaged", to: branches[0]?.id ?? "" }); setErr(""); } }, [b?.id]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!b) return null;
  // Quantities are typed in packs, or "packs+loose" (2+5) for medicines kept in loose units.
  const qty = parseQty(f.qty, m.packSize) ?? 0;
  const qtyLabel = m.packSize > 1 ? `Quantity (${m.packUnit}s, or ${m.packUnit}s+${m.looseUnit}s e.g. 2+5)` : "Units";
  const qtyInput = <Input value={f.qty} onChange={(e) => setF({ ...f, qty: e.target.value.replace(/[^\d+ ]/g, "") })} inputMode="numeric" autoFocus placeholder={m.packSize > 1 ? "2+5" : ""} />;
  const needsQty = f.action !== "quarantine" && f.action !== "release";
  const submit = () => start(async () => {
    setErr("");
    if (needsQty && qty < 1) return setErr("Enter a quantity.");
    const reason = f.reason.trim();
    const r = f.action === "adjust" ? await adjustAction(b.id, f.dir === "add" ? qty : -qty, reason)
      : f.action === "writeoff" ? (reason.length < 3 ? null : await writeOffAction(b.id, qty, `${f.kind}: ${reason}`))
        : f.action === "return" ? await returnAction(b.id, qty, reason)
          : f.action === "transfer" ? await requestTransferAction(b.id, f.to, qty, reason)
            : await quarantineAction(b.id, f.action === "quarantine", reason);
    if (!r) return setErr("Describe what happened.");
    if (!r.ok) return setErr(r.error);
    const no = typeof r.data === "string" ? r.data : "";
    toast(f.action === "adjust" ? `${no} posted. ${b.batchNo} is now ${fmtQty(b.qty + (f.dir === "add" ? qty : -qty), m)}.`
      : f.action === "writeoff" ? `${no} posted to Stock loss.`
        : f.action === "return" ? `${no} raised. Stock and payable reduced.`
          : f.action === "transfer" ? `${no} requested. Someone else at ${branches.find((x) => x.id === f.to)?.name ?? "the branch"} or a manager approves it under Inventory → Transfers.`
            : r.message ?? "Saved.", "green");
    onClose();
  });
  return (
    <Modal open onClose={onClose} width={480} title={`${m.name} · ${b.batchNo}`} sub={<>{b.qtyText} in stock · cost {inr(b.cost)}{m.packSize > 1 ? `/${m.packUnit}` : ""} · exp {monthYear(b.expiry)}{b.status !== "ok" ? ` · ${b.status}` : ""}</>}
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant={f.action === "writeoff" ? "danger" : "primary"} onClick={submit} disabled={pending || !avail.length}>{pending ? "Saving…" : ACTIONS[f.action]}</Button></>}>
      {avail.length ? <>
        <Field label="Action"><Select value={f.action} onChange={(e) => setF({ ...f, action: e.target.value as ActionId })}>{avail.map((a) => <option key={a} value={a}>{ACTIONS[a]}</option>)}</Select></Field>
        {f.action === "adjust" ? (
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Direction"><Select value={f.dir} onChange={(e) => setF({ ...f, dir: e.target.value as "add" | "remove" })}><option value="remove">Remove units (−)</option><option value="add">Add units (+)</option></Select></Field>
            <Field label={qtyLabel}>{qtyInput}</Field>
          </div>
        ) : null}
        {f.action === "writeoff" ? (
          <div className="grid grid-cols-2 gap-2.5">
            <Field label="Reason"><Select value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}><option>Damaged</option><option>Expired</option><option>Lost</option></Select></Field>
            <Field label={qtyLabel}>{qtyInput}</Field>
          </div>
        ) : null}
        {f.action === "return" || f.action === "transfer" ? (
          <div className="grid grid-cols-2 gap-2.5">
            {f.action === "transfer" ? <Field label="To branch"><Select value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })}>{branches.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}</Select></Field> : null}
            <Field label={qtyLabel}>{qtyInput}</Field>
          </div>
        ) : null}
        <Field label={f.action === "adjust" || f.action === "return" || f.action === "writeoff" ? "Details (required)" : "Note"}>
          <Input value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder={f.action === "adjust" ? "e.g. found in back store, miscounted at GRN" : f.action === "writeoff" ? "e.g. strip torn, water damage" : f.action === "return" ? "e.g. near expiry, wrong item supplied" : f.action === "quarantine" ? "e.g. supplier advisory, damaged pack" : "Optional"} />
        </Field>
        <div className="text-[12px] text-faint">
          {f.action === "adjust" ? "Posts a stock movement and an accounting journal at cost (Inventory and Stock loss). Audited." : f.action === "writeoff" ? "Removes the units and posts their cost to Stock loss." : f.action === "return" ? "Raises a debit note: reduces stock, the supplier payable and input GST." : f.action === "transfer" ? "Creates a request. Stock leaves this branch when someone other than you (or an owner) approves it." : f.action === "quarantine" ? "Blocks the batch from sale until released." : "Makes the batch sellable again."}
        </div>
      </> : <div className="text-[13.5px] text-muted">No actions are available for this batch with your role.</div>}
      {err ? <div role="alert" className="text-[13px] text-bad">{err}</div> : null}
    </Modal>
  );
}

const TR: Record<string, [string, Tone]> = { pending: ["Awaiting approval", "amber"], in_transit: ["In transit", "blue"], received: ["Received", "green"], rejected: ["Rejected", "red"], cancelled: ["Cancelled", "gray"] };

function TransfersPanel({ transfers }: { transfers: Transfers }) {
  const toastR = useActionToast();
  const [pending, start] = useTransition();
  const go = (id: string, a: "approve" | "reject" | "receive" | "cancel") => start(async () => { toastR(await transferAction(id, a)); });
  return (
    <div className="bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] px-4 py-3">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-1"><div className="font-semibold text-[14.5px]">Stock transfers</div><span className="text-[12px] text-faint">Approve at the sending branch, receive at the destination. Request one from a batch’s Actions.</span></div>
      {transfers.length ? transfers.map((x) => {
        const [label, tone] = TR[x.status] ?? [x.status, "gray"];
        return (
          <div key={x.id} className="grid grid-cols-[90px_minmax(150px,1fr)_minmax(0,1.6fr)_60px_auto_auto] gap-3 items-center py-2 border-b border-row last:border-0 text-[13.5px] max-md:grid-cols-2">
            <span className="flex flex-col"><span className="font-mono text-[12.5px]">{x.no}</span><span className="text-[11.5px] text-faint">{dayMonth(new Date(x.createdAt))}</span></span>
            <span>{x.from} → {x.to}</span>
            <span className="text-muted truncate" title={x.note ?? ""}>{x.item}<span className="text-faint"> · by {x.by}{x.note ? ` · ${x.note}` : ""}</span></span>
            <span className="tnum">× {x.qtyText}</span><Badge tone={tone}>{label}</Badge>
            <span className="flex gap-1.5 justify-end">
              {x.canApprove ? <Button size="sm" variant="primary" disabled={pending} onClick={() => go(x.id, "approve")}>Approve</Button> : x.status === "pending" && x.canReject ? <span className="text-[12px] text-faint self-center">Needs another approver</span> : null}
              {x.canReject ? <Button size="sm" disabled={pending} onClick={() => go(x.id, "reject")}>Reject</Button> : null}
              {x.canReceive ? <Button size="sm" variant="primary" disabled={pending} onClick={() => go(x.id, "receive")}>Mark received</Button> : null}
              {x.canCancel ? <Button size="sm" disabled={pending} onClick={() => { if (confirm(`Cancel ${x.no}? The stock goes back to ${x.from}.`)) go(x.id, "cancel"); }}>Cancel</Button> : null}
            </span>
          </div>
        );
      }) : <Empty icon={ArrowLeftRight} title="No transfers yet" body="Open a medicine, choose Actions on a batch and pick “Transfer to another branch”." />}
    </div>
  );
}

const EMPTY: Record<keyof MedicineInput, string> = { name: "", generic: "", strength: "", form: "Tablet", manufacturer: "", pack: "", mrp: "", gstRate: "12", schedule: "", reorderLevel: "10", barcode: "", hsn: "3004", rack: "",
  composition: "", packSize: "1", packUnit: "strip", looseUnit: "tab", allowLoose: "", caseSize: "1", caseUnit: "box" };

function MedicineModal({ open, edit, onClose, onSaved }: { open: boolean; edit: Detail["medicine"] | null; onClose: () => void; onSaved: (id?: string) => void }) {
  const toastR = useActionToast();
  const [f, setF] = useState(EMPTY);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  useEffect(() => {
    if (!open) return;
    setErr("");
    setF(edit ? { name: edit.name, generic: edit.generic, strength: edit.strength, form: edit.form, manufacturer: edit.manufacturer, pack: edit.pack, mrp: (edit.mrp / 100).toFixed(2), gstRate: String(edit.gstRate), schedule: edit.schedule, reorderLevel: String(edit.reorderLevel), barcode: edit.barcode ?? "", hsn: edit.hsn, rack: edit.rack,
      composition: edit.composition, packSize: String(edit.packSize), packUnit: edit.packUnit, looseUnit: edit.looseUnit, allowLoose: edit.allowLoose ? "true" : "", caseSize: String(edit.caseSize), caseUnit: edit.caseUnit } : EMPTY);
  }, [open, edit]);
  const set = (k: keyof MedicineInput) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const save = () => start(async () => {
    const input = f as unknown as MedicineInput;
    const r = edit ? await editMedicineAction(edit.id, edit.version, input) : await addMedicineAction(input);
    if (!r.ok) return setErr(r.error);
    toastR(r);
    onSaved(edit ? undefined : (r.data as string));
  });
  return (
    <Modal open={open} onClose={onClose} width={580} title={edit ? `Edit ${edit.name}` : "Add medicine"}
      sub="Enter details from the pack or the supplier invoice. Medoro does not autofill medicine data."
      footer={<><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={pending}>{pending ? "Saving…" : "Save medicine"}</Button></>}>
      <div className="grid grid-cols-2 gap-2.5 max-sm:grid-cols-1">
        <Field label="Brand name *"><Input value={f.name} onChange={set("name")} autoFocus /></Field>
        <Field label="Generic / salt *"><Input value={f.generic} onChange={set("generic")} /></Field>
        <Field label="Strength *"><Input value={f.strength} onChange={set("strength")} placeholder="e.g. 500 mg" /></Field>
        <Field label="Form"><Select value={f.form} onChange={set("form")}>{FORMS.map((x) => <option key={x}>{x}</option>)}</Select></Field>
        <Field label="Manufacturer *"><Input value={f.manufacturer} onChange={set("manufacturer")} /></Field>
        <Field label="Pack"><Input value={f.pack} onChange={set("pack")} placeholder="e.g. 10 tabs" /></Field>
        <Field label="MRP per pack ₹ *"><Input value={f.mrp} onChange={set("mrp")} inputMode="decimal" /></Field>
        <Field label="GST rate"><Select value={f.gstRate} onChange={set("gstRate")}>{GST_RATES.map((g) => <option key={g} value={g}>GST {g}%</option>)}</Select></Field>
        <Field label="Schedule"><Select value={f.schedule} onChange={set("schedule")}><option value="">OTC</option><option value="H">Schedule H</option><option value="H1">Schedule H1</option><option value="X">Schedule X</option><option value="G">Schedule G</option></Select></Field>
        <Field label="Reorder level"><Input value={f.reorderLevel} onChange={set("reorderLevel")} inputMode="numeric" /></Field>
        <Field label="Barcode"><Input value={f.barcode} onChange={set("barcode")} className="font-mono" placeholder="Scan or type" /></Field>
        <div className="grid grid-cols-2 gap-2.5">
          <Field label="HSN"><Input value={f.hsn} onChange={set("hsn")} className="font-mono" /></Field>
          <Field label="Rack"><Input value={f.rack} onChange={set("rack")} /></Field>
        </div>
        <div className="col-span-2 max-sm:col-span-1"><Field label="Composition (salts with strengths)"><Input value={f.composition} onChange={set("composition")} placeholder="e.g. Paracetamol 500mg + Caffeine 25mg · blank uses generic + strength" /></Field></div>
      </div>
      <div className="flex flex-col gap-2 p-3 bg-[#F7FAFA] border border-[#E3E6E9] rounded-[10px]">
        <div className="text-[13px] font-semibold">Units</div>
        <div className="grid grid-cols-3 gap-2.5 max-sm:grid-cols-1">
          <Field label="Pack is a"><Input value={f.packUnit} onChange={set("packUnit")} placeholder="strip" /></Field>
          <Field label="Units per pack"><Input value={f.packSize} onChange={set("packSize")} inputMode="numeric" /></Field>
          <Field label="Loose unit"><Input value={f.looseUnit} onChange={set("looseUnit")} placeholder="tab" /></Field>
          <Field label="Purchase case"><Input value={f.caseUnit} onChange={set("caseUnit")} placeholder="box" /></Field>
          <Field label="Packs per case"><Input value={f.caseSize} onChange={set("caseSize")} inputMode="numeric" /></Field>
          <div className="self-end pb-2"><Checkbox checked={f.allowLoose === "true"} onChange={(e) => setF((x) => ({ ...x, allowLoose: e.target.checked ? "true" : "" }))} label="Sell loose" /></div>
        </div>
        <div className="text-[12px] text-faint">
          {Number(f.packSize) > 1 ? `Stock is counted in ${f.looseUnit || "units"}: 1 ${f.packUnit || "pack"} = ${f.packSize} ${f.looseUnit || "units"}. A loose ${f.looseUnit || "unit"} sells at MRP ÷ ${f.packSize}, rounded down to the paisa.` : "Units per pack 1 keeps stock in whole packs."}
          {edit && Number(f.packSize) !== edit.packSize ? ` Changing it rescales existing stock (${edit.packSize} → ${f.packSize}); the new size must be a multiple of ${edit.packSize} while stock is held.` : ""}
        </div>
      </div>
      {err ? <div role="alert" className={cn("text-[13px] text-bad")}>{err}</div> : null}
    </Modal>
  );
}
