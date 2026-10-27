"use client";
import { useEffect, useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Search, Plus, X, Pencil, PackageOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge, type Tone } from "@/components/ui/badge";
import { Empty } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useActionToast, useToast } from "@/components/ui/toast";
import { cn } from "@/components/ui/cn";
import { inr } from "@/lib/money";
import { monthYear, todayISO } from "@/lib/dates";
import { FORMS, GST_RATES, type MedicineInput, type ReceiveInput } from "@/domain/inventory/contracts";
import type { listInventory, medicineDetail, InvFilter } from "@/domain/inventory/service";
import { addMedicineAction, editMedicineAction, quarantineAction, receiveBatchAction } from "./actions";

type List = Awaited<ReturnType<typeof listInventory>>;
type Detail = NonNullable<Awaited<ReturnType<typeof medicineDetail>>>;

const FILTERS: [InvFilter, string][] = [["all", "All"], ["low", "Low stock"], ["rx", "Schedule H/H1"], ["exp", "Expiring ≤ 90 d"]];
const th = "text-left text-[12px] font-medium text-muted px-3.5 py-2.5 border-b border-[#E3E6E9] whitespace-nowrap";
const td = "px-3.5 py-2.5 border-b border-row";

export function InventoryView({ list, detail, q, filter, openAdd, canEdit, canAdjust, canPurchase }: {
  list: List; detail: Detail | null; q: string; filter: InvFilter; openAdd: boolean; canEdit: boolean; canAdjust: boolean; canPurchase: boolean;
}) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  const [query, setQuery] = useState(q);
  const [modal, setModal] = useState<null | "add" | "edit">(openAdd && canEdit ? "add" : null);

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

  return (
    <div className="flex flex-col gap-3.5 max-w-[1400px]">
      <div className="flex gap-2.5 flex-wrap items-center">
        <div className="relative flex-1 min-w-[240px] max-w-[420px]">
          <Search size={16} className="absolute left-[11px] top-1/2 -translate-y-1/2 text-fainter" />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search name, generic, manufacturer or barcode" aria-label="Search inventory"
            className="w-full border border-input rounded-lg py-[9px] pr-[11px] pl-[34px] text-[14px] outline-none bg-white focus:border-teal" />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {FILTERS.map(([id, label]) => (
            <button key={id} onClick={() => nav({ filter: id === "all" ? null : id })} className="rounded-full px-3 py-1.5 text-[13px] font-medium cursor-pointer border"
              style={filter === id ? { background: "#0B5E5B", color: "#fff", borderColor: "#0B5E5B" } : { background: "#fff", color: "#3D454D", borderColor: "#CDD2D7" }}>{label}</button>
          ))}
        </div>
        <div className="ml-auto flex gap-2.5 items-center">
          <span className="text-[12.5px] text-muted">{list.rows.length} of {list.total} medicines</span>
          {canEdit ? <Button variant="primary" onClick={() => setModal("add")}><Plus size={16} />Add medicine</Button> : null}
        </div>
      </div>

      <div className="bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] overflow-auto">
        {list.rows.length ? (
          <table className="w-full border-collapse min-w-[860px] text-[14px]">
            <thead><tr className="bg-subtle">
              <th className={th}>Medicine</th><th className={th}>Manufacturer</th><th className={th + " text-right"}>Sellable</th><th className={th + " text-right"}>Reorder</th>
              <th className={th}>Batches</th><th className={th}>Nearest expiry</th><th className={th + " text-right"}>MRP</th><th className={th}>GST</th><th className={th}>Sch.</th>
            </tr></thead>
            <tbody>
              {list.rows.map((r) => (
                <tr key={r.id} onClick={() => nav({ sel: r.id })} className="cursor-pointer hover:bg-[#FAFCFC]" style={{ background: detail?.medicine.id === r.id ? "#F0F7F6" : undefined }}>
                  <td className={td}><div className="font-semibold">{r.name}</div><div className="text-[12px] text-muted">{r.meta}</div></td>
                  <td className={td + " text-ink-2"}>{r.manufacturer}</td>
                  <td className={td + " text-right font-semibold tnum"} style={{ color: r.sellable < r.reorder ? "#B3261E" : "#1F2328" }}>{r.sellable}</td>
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
            action={canEdit ? <Button variant="primary" onClick={() => setModal("add")}><Plus size={16} />Add your first medicine</Button> : null} />
        )}
      </div>

      {detail ? <Drawer d={detail} onClose={() => nav({ sel: null })} onEdit={() => setModal("edit")} canEdit={canEdit} canAdjust={canAdjust} canPurchase={canPurchase} /> : null}
      <MedicineModal open={modal !== null} edit={modal === "edit" ? detail?.medicine ?? null : null} onClose={() => setModal(null)} onSaved={(id) => { setModal(null); if (id) nav({ sel: id, q: null, filter: null }); }} />
    </div>
  );
}

function Drawer({ d, onClose, onEdit, canEdit, canAdjust, canPurchase }: { d: Detail; onClose: () => void; onEdit: () => void; canEdit: boolean; canAdjust: boolean; canPurchase: boolean }) {
  const m = d.medicine;
  const toastR = useActionToast();
  const toast = useToast();
  const [pending, start] = useTransition();
  const [rcv, setRcv] = useState({ batchNo: "", expiry: "", qty: "", cost: "", mrp: (m.mrp / 100).toFixed(2), supplierId: "", invoiceNo: "" });
  useEffect(() => { setRcv({ batchNo: "", expiry: "", qty: "", cost: "", mrp: (m.mrp / 100).toFixed(2), supplierId: "", invoiceNo: "" }); }, [m.id, m.mrp]);
  useEffect(() => { const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [onClose]);

  const receive = () => start(async () => {
    const r = await receiveBatchAction({ medicineId: m.id, batchNo: rcv.batchNo, expiry: rcv.expiry, qty: rcv.qty, cost: rcv.cost, mrp: rcv.mrp, supplierId: rcv.supplierId || null, invoiceNo: rcv.invoiceNo } as unknown as ReceiveInput);
    if (!r.ok) return toast(r.error, "red");
    toast(`Batch ${rcv.batchNo.toUpperCase()} received: ${rcv.qty} units${r.data.grnNo ? " · " + r.data.grnNo : ""}.`, "green");
    setRcv((x) => ({ ...x, batchNo: "", expiry: "", qty: "", cost: "", invoiceNo: "" }));
  });
  const quarantine = (id: string, q: boolean) => {
    const note = q ? window.prompt("Reason for quarantine (e.g. damaged, supplier advisory):", "") : "";
    if (q && note === null) return;
    start(async () => { toastR(await quarantineAction(id, q, note ?? "")); });
  };
  const status = (b: Detail["batches"][number]): [string, Tone] =>
    b.status === "quarantine" ? ["Quarantined", "amber"] : b.status !== "ok" ? [b.status[0].toUpperCase() + b.status.slice(1), "red"]
      : b.days <= 0 ? ["Expired · blocked", "red"] : b.qty === 0 ? ["Sold out", "gray"] : b.days <= 60 ? [`${b.days} days left`, "amber"] : ["Sellable", "green"];
  const minMonth = todayISO().slice(0, 7);
  const ri = "border border-input rounded-[7px] px-2.5 py-2 text-[13.5px] outline-none bg-white focus:border-teal w-full";

  return (
    <>
      <div onClick={onClose} className="fixed inset-0 bg-[rgba(20,28,32,.3)] z-50" />
      <div role="dialog" aria-label={m.name} className="fixed right-0 top-0 bottom-0 w-[min(620px,100vw)] bg-white z-[51] shadow-[-12px_0_32px_rgba(0,0,0,.15)] flex flex-col">
        <div className="flex items-start gap-3 px-[22px] py-[18px] border-b border-[#E3E6E9]">
          <div className="flex-1 flex flex-col gap-0.5"><div className="text-[18px] font-semibold">{m.name}</div><div className="text-[13px] text-muted">{m.generic} · {m.strength} · {m.form} · {m.pack}</div></div>
          {canEdit ? <Button size="sm" onClick={onEdit}><Pencil size={13} />Edit</Button> : null}
          <button onClick={onClose} aria-label="Close" className="p-1.5 text-muted cursor-pointer"><X size={20} /></button>
        </div>
        <div className="flex-1 overflow-auto px-[22px] py-[18px] flex flex-col gap-[18px]">
          <div className="grid grid-cols-[repeat(auto-fit,minmax(130px,1fr))] gap-x-4 gap-y-2.5 text-[13px]">
            {[["Manufacturer", m.manufacturer], ["Barcode", m.barcode ?? "—", true], ["HSN · GST", `${m.hsn} · ${m.gstRate}%`], ["MRP", inr(m.mrp)], ["Schedule", m.schedule ? "Schedule " + m.schedule : "OTC"],
              ["Sellable · reorder", `${d.sellable} · ${m.reorderLevel}`], ["Sales velocity", `${d.velocity.toFixed(1)} / day (28-day avg)`], ["Rack", m.rack || "—"]].map(([k, v, mono]) => (
              <div key={k as string} className="flex flex-col"><span className="text-muted text-[12px]">{k}</span><span className={mono ? "font-mono" : ""}>{v}</span></div>
            ))}
          </div>

          <div className="flex flex-col gap-2">
            <div className="font-semibold text-[14.5px]">Batches (FEFO order)</div>
            {d.batches.length ? (
              <div className="border border-[#E3E6E9] rounded-lg overflow-hidden">
                {d.batches.map((b) => {
                  const [label, tone] = status(b);
                  return (
                    <div key={b.id} className="grid grid-cols-[minmax(0,1fr)_auto_auto_auto] gap-3 items-center px-3 py-2.5 border-b border-row last:border-0 text-[13px]">
                      <div className="flex flex-col min-w-0"><span className="font-mono font-medium">{b.batchNo}</span><span className="text-[12px] text-muted truncate">Exp {monthYear(b.expiry)} · {b.supplier} · cost {inr(b.cost)}{b.mrp !== m.mrp ? ` · MRP ${inr(b.mrp)}` : ""}{b.note ? ` · ${b.note}` : ""}</span></div>
                      <span className="font-semibold tnum">{b.qty}</span>
                      <Badge tone={tone}>{label}</Badge>
                      {canAdjust && b.days > 0 && b.qty > 0 && (b.status === "ok" || b.status === "quarantine")
                        ? <Button size="sm" disabled={pending} onClick={() => quarantine(b.id, b.status === "ok")}>{b.status === "ok" ? "Quarantine" : "Release"}</Button> : <span />}
                    </div>
                  );
                })}
              </div>
            ) : <div className="text-[13px] text-fainter">No batches at this branch yet.</div>}
          </div>

          {canEdit ? (
            <div className="flex flex-col gap-2 p-3.5 bg-[#F7FAFA] border border-[#E3E6E9] rounded-[10px]">
              <div className="font-semibold text-[14.5px]">Receive a batch</div>
              <div className="grid grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-2">
                <input className={ri + " font-mono uppercase"} value={rcv.batchNo} onChange={(e) => setRcv({ ...rcv, batchNo: e.target.value.toUpperCase() })} placeholder="Batch no." aria-label="Batch number" />
                <input className={ri} type="month" min={minMonth} value={rcv.expiry} onChange={(e) => setRcv({ ...rcv, expiry: e.target.value })} aria-label="Expiry month" title="Expiry (month/year on the pack)" />
                <input className={ri} value={rcv.qty} onChange={(e) => setRcv({ ...rcv, qty: e.target.value.replace(/\D/g, "") })} placeholder="Qty (packs)" inputMode="numeric" aria-label="Quantity" />
                <input className={ri} value={rcv.cost} onChange={(e) => setRcv({ ...rcv, cost: e.target.value.replace(/[^\d.]/g, "") })} placeholder="Cost / pack ₹" inputMode="decimal" aria-label="Cost per pack" />
                <input className={ri} value={rcv.mrp} onChange={(e) => setRcv({ ...rcv, mrp: e.target.value.replace(/[^\d.]/g, "") })} placeholder="MRP / pack ₹" inputMode="decimal" aria-label="MRP per pack" title="MRP printed on this batch" />
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
                <span className="text-[12px] text-faint">{rcv.supplierId ? "Posts the GRN, the supplier payable and input GST." : d.suppliers.length || !canPurchase ? "For stock already on your shelves." : "Add suppliers under Suppliers & customers to post GRNs."}</span>
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
                <span className="font-semibold tnum" style={{ color: mv.qty < 0 ? "#B3261E" : mv.qty > 0 ? "#1E7F4F" : "#5B636B" }}>{mv.qty > 0 ? "+" : ""}{mv.qty}</span>
              </div>
            )) : <div className="text-[13px] text-fainter">No movements yet.</div>}
          </div>
        </div>
      </div>
    </>
  );
}

const EMPTY: Record<keyof MedicineInput, string> = { name: "", generic: "", strength: "", form: "Tablet", manufacturer: "", pack: "", mrp: "", gstRate: "12", schedule: "", reorderLevel: "10", barcode: "", hsn: "3004", rack: "" };

function MedicineModal({ open, edit, onClose, onSaved }: { open: boolean; edit: Detail["medicine"] | null; onClose: () => void; onSaved: (id?: string) => void }) {
  const toastR = useActionToast();
  const [f, setF] = useState(EMPTY);
  const [err, setErr] = useState("");
  const [pending, start] = useTransition();
  useEffect(() => {
    if (!open) return;
    setErr("");
    setF(edit ? { name: edit.name, generic: edit.generic, strength: edit.strength, form: edit.form, manufacturer: edit.manufacturer, pack: edit.pack, mrp: (edit.mrp / 100).toFixed(2), gstRate: String(edit.gstRate), schedule: edit.schedule, reorderLevel: String(edit.reorderLevel), barcode: edit.barcode ?? "", hsn: edit.hsn, rack: edit.rack } : EMPTY);
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
      </div>
      {err ? <div role="alert" className={cn("text-[13px] text-bad")}>{err}</div> : null}
    </Modal>
  );
}
