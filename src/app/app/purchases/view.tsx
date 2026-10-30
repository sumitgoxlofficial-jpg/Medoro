"use client";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, Upload, FileText, Printer, ChevronDown, ChevronRight, CircleCheck, CircleAlert, ScanLine } from "lucide-react";
import { Segmented } from "@/components/ui/segmented";
import { Button } from "@/components/ui/button";
import { Badge, type Tone } from "@/components/ui/badge";
import { Empty } from "@/components/ui/card";
import { Field, Select } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { inr, inr0, toPaise } from "@/lib/money";
import { dayMonth, daysTo } from "@/lib/dates";
import { grnTotals, LOW_CONFIDENCE } from "@/domain/purchasing/contracts";
import type { listOrders, pendingScans, purchaseCatalogue, recentGrns } from "@/domain/purchasing/service";
import { createPoAction, discardScanAction, poStatusAction, postGrnAction, uploadInvoiceAction } from "./actions";

type Order = Awaited<ReturnType<typeof listOrders>>[number];
type Cat = Awaited<ReturnType<typeof purchaseCatalogue>>[number];
type Grn = Awaited<ReturnType<typeof recentGrns>>[number];
type Scan = Awaited<ReturnType<typeof pendingScans>>[number];
type Sup = { id: string; name: string };

const STATUS: Record<string, [string, Tone]> = { draft: ["Draft", "gray"], ordered: ["Ordered", "blue"], partially_received: ["Partially received", "amber"], received: ["Received", "green"], cancelled: ["Cancelled", "red"], closed: ["Closed short", "gray"] };
const th = "text-left text-[12px] font-medium text-muted px-3 py-2.5 border-b border-[#E3E6E9] whitespace-nowrap";
const td = "px-3 py-2.5 border-b border-row";
const cell = "border border-input rounded-md px-2 py-1.5 text-[13px] bg-white outline-none focus:border-teal w-full min-w-0";
const wrap = "bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)]";

export function PurchasesView({ tab, poId, orders, catalogue, suppliers, grns, scans, ocr, today }: {
  tab: "po" | "receive"; poId: string | null; orders: Order[]; catalogue: Cat[]; suppliers: Sup[]; grns: Grn[]; scans: Scan[]; ocr: boolean; today: string;
}) {
  const router = useRouter();
  return (
    <div className="flex flex-col gap-3.5 max-w-[1400px]">
      <Segmented value={tab} onChange={(v) => router.replace(v === "receive" ? "/app/purchases?tab=receive" : "/app/purchases")} className="self-start bg-[#EEF0F2]"
        options={[{ value: "po", label: "Purchase orders" }, { value: "receive", label: `Receive invoice (GRN)${scans.length ? ` · ${scans.length} to review` : ""}` }]} />
      {tab === "po" ? <Orders orders={orders} catalogue={catalogue} suppliers={suppliers} grns={grns} /> : <Receive key={poId ?? "none"} po={orders.find((o) => o.id === poId) ?? null} orders={orders} catalogue={catalogue} suppliers={suppliers} scans={scans} ocr={ocr} today={today} />}
    </div>
  );
}

function Orders({ orders, catalogue, suppliers, grns }: { orders: Order[]; catalogue: Cat[]; suppliers: Sup[]; grns: Grn[] }) {
  const router = useRouter();
  const toast = useToast();
  const [open, setOpen] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [, start] = useTransition();
  const act = (id: string, a: "place" | "cancel" | "close", reason = "") => start(async () => { const r = await poStatusAction(id, a, reason); toast(r.ok ? r.message! : r.error, r.ok ? "green" : "red"); });
  const withReason = (o: Order, a: "cancel" | "close") => {
    const reason = prompt(a === "cancel" ? `Cancel ${o.no}? Enter the reason:` : `Close ${o.no} short? Lines not yet delivered can’t be received against it any more. Enter the reason:`, "");
    if (reason === null) return;
    if (reason.trim().length < 3) return toast("Enter a reason.", "red");
    act(o.id, a, reason);
  };
  return (
    <>
      <div className="flex justify-end"><Button variant="primary" onClick={() => setCreating(true)} disabled={!suppliers.length || !catalogue.length} title={!suppliers.length ? "Add a supplier first" : !catalogue.length ? "Add medicines first" : ""}><Plus size={16} />New purchase order</Button></div>
      <div className={wrap + " overflow-auto"}>
        {orders.length ? (
          <table className="w-full border-collapse min-w-[820px] text-[14px]">
            <thead><tr className="bg-subtle"><th className={th} /><th className={th}>PO</th><th className={th}>Supplier</th><th className={th}>Date</th><th className={th + " text-right"}>Items</th><th className={th + " text-right"}>Value</th><th className={th}>Status</th><th className={th} /></tr></thead>
            <tbody>
              {orders.map((o) => {
                const [label, tone] = STATUS[o.status];
                const isOpen = open === o.id;
                return (
                  <FragmentRow key={o.id}>
                    <tr className="cursor-pointer hover:bg-[#FAFCFC]" onClick={() => setOpen(isOpen ? null : o.id)}>
                      <td className={td + " w-6 text-faint"}>{isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}</td>
                      <td className={td + " font-mono text-[13px]"}>{o.no}</td><td className={td}>{o.supplier}</td><td className={td + " text-muted"}>{dayMonth(new Date(o.date), true)}</td>
                      <td className={td + " text-right tnum"}>{o.items.length}</td><td className={td + " text-right tnum font-semibold"}>{inr0(o.total)}</td>
                      <td className={td}><Badge tone={tone}>{label}</Badge>{o.source && o.source !== "manual" ? <span className="ml-1.5 text-[11.5px] text-faint">from {o.source}</span> : null}</td>
                      <td className={td + " text-right whitespace-nowrap"} onClick={(e) => e.stopPropagation()}>
                        <div className="flex gap-1.5 justify-end">
                          {o.status === "draft" ? <Button size="sm" variant="primary" onClick={() => act(o.id, "place")}>Place order</Button> : null}
                          {o.status === "ordered" || o.status === "partially_received" ? <Button size="sm" variant="primary" onClick={() => router.push(`/app/purchases?tab=receive&po=${o.id}`)}>Receive</Button> : null}
                          {o.status !== "draft" && o.status !== "cancelled" ? <Button size="sm" aria-label="Print" onClick={() => window.open(`/print/po/${o.id}`, "_blank", "noopener")}><Printer size={13} /></Button> : null}
                          {o.status === "partially_received" ? <Button size="sm" onClick={() => withReason(o, "close")}>Close short</Button> : null}
                          {o.status === "draft" || o.status === "ordered" ? <Button size="sm" variant="danger-outline" onClick={() => withReason(o, "cancel")}>Cancel</Button> : null}
                        </div>
                      </td>
                    </tr>
                    {isOpen ? (
                      <tr><td colSpan={8} className="bg-subtle px-10 py-2 border-b border-row">
                        {o.closedReason ? <div className="text-[12.5px] text-muted pb-1">{o.status === "closed" ? "Closed short" : "Cancelled"}: {o.closedReason}</div> : null}
                        {o.items.map((i) => (
                          <div key={i.id} className="grid grid-cols-[minmax(0,1fr)_100px_110px_140px] gap-3 py-1 text-[13px]">
                            <span>{i.name}</span><span className="tnum text-right">{i.qty} × {inr(i.rate)}</span><span className="tnum text-right">{inr(i.qty * i.rate)}</span>
                            <span className="text-right" style={{ color: i.received >= i.qty ? "#1E7F4F" : i.received ? "#94570A" : "#8A929A" }}>received {i.received} / {i.qty}</span>
                          </div>
                        ))}
                      </td></tr>
                    ) : null}
                  </FragmentRow>
                );
              })}
            </tbody>
          </table>
        ) : <Empty icon={FileText} title="No purchase orders yet" body={!suppliers.length ? "Add suppliers under Suppliers & customers, then create orders here." : "Create an order, place it with your supplier, then receive the invoice against it."} />}
      </div>
      {grns.length ? (
        <div className={wrap + " px-4 py-3"}>
          <div className="font-semibold text-[14.5px] mb-1.5">Recent GRNs</div>
          {grns.map((g) => (
            <div key={g.id} className="grid grid-cols-[150px_minmax(0,1fr)_auto_auto] gap-3 py-1.5 border-b border-row last:border-0 text-[13px] items-baseline">
              <span className="font-mono text-[12px]">{g.no}</span><span className="truncate">{g.supplier} <span className="text-muted">· Inv {g.invoiceNo} · {g.lines} line(s)</span></span>
              <span className="text-muted">{dayMonth(new Date(g.date))}</span><strong className="tnum">{inr0(g.total)}</strong>
            </div>
          ))}
        </div>
      ) : null}
      <NewPo open={creating} onClose={() => setCreating(false)} catalogue={catalogue} suppliers={suppliers} />
    </>
  );
}

function FragmentRow({ children }: { children: React.ReactNode }) { return <>{children}</>; }

function NewPo({ open, onClose, catalogue, suppliers }: { open: boolean; onClose: () => void; catalogue: Cat[]; suppliers: Sup[] }) {
  const toast = useToast();
  const [sup, setSup] = useState(""), [lines, setLines] = useState<{ medicineId: string; qty: string; rate: string }[]>([]);
  const [err, setErr] = useState(""), [pending, start] = useTransition();
  useEffect(() => { if (open) { setSup(suppliers[0]?.id ?? ""); setLines([{ medicineId: "", qty: "", rate: "" }]); setErr(""); } }, [open, suppliers]);
  const total = lines.reduce((a, l) => a + (parseInt(l.qty) || 0) * toPaise(l.rate), 0);
  const save = () => start(async () => {
    const r = await createPoAction({ supplierId: sup, lines: lines.filter((l) => l.medicineId) });
    if (!r.ok) return setErr(r.error);
    toast(`${r.data.no} saved as a draft. Nothing is sent until you place it.`, "green"); onClose();
  });
  return (
    <Modal open={open} onClose={onClose} title="New purchase order" width={720}
      footer={<><span className="mr-auto self-center text-[13.5px]">Value <strong className="tnum">{inr(total)}</strong> <span className="text-faint">excl. GST</span></span><Button onClick={onClose}>Cancel</Button><Button variant="primary" onClick={save} disabled={pending}>Save draft</Button></>}>
      <Field label="Supplier"><Select value={sup} onChange={(e) => setSup(e.target.value)}>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
      <div className="flex flex-col gap-1.5">
        <div className="grid grid-cols-[minmax(0,1fr)_80px_110px_28px] gap-2 text-[12px] text-muted"><span>Medicine</span><span>Qty</span><span>Rate ₹ ex-GST</span><span /></div>
        {lines.map((l, i) => (
          <div key={i} className="grid grid-cols-[minmax(0,1fr)_80px_110px_28px] gap-2">
            <select className={cell} value={l.medicineId} aria-label="Medicine" onChange={(e) => { const c = catalogue.find((x) => x.id === e.target.value); setLines(lines.map((x, j) => (j === i ? { ...x, medicineId: e.target.value, rate: x.rate || (c?.lastRate ? (c.lastRate / 100).toFixed(2) : "") } : x))); }}>
              <option value="">Choose…</option>{catalogue.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
            <input className={cell} value={l.qty} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, qty: e.target.value.replace(/\D/g, "") } : x)))} inputMode="numeric" aria-label="Quantity" />
            <input className={cell} value={l.rate} onChange={(e) => setLines(lines.map((x, j) => (j === i ? { ...x, rate: e.target.value.replace(/[^\d.]/g, "") } : x)))} inputMode="decimal" aria-label="Rate" />
            <button onClick={() => setLines(lines.filter((_, j) => j !== i))} aria-label="Remove line" className="text-fainter hover:text-bad cursor-pointer"><Trash2 size={15} /></button>
          </div>
        ))}
        <Button size="sm" className="self-start" onClick={() => setLines([...lines, { medicineId: "", qty: "", rate: "" }])}><Plus size={14} />Add line</Button>
      </div>
      {err ? <div role="alert" className="text-[13px] text-bad">{err}</div> : null}
    </Modal>
  );
}

type RLine = { key: string; medicineId: string; batchNo: string; expiry: string; qty: string; freeQty: string; rate: string; mrp: string; poItemId: string | null; text?: string; confidence?: number; ocrIndex?: number; verified: boolean };
const blank = (): RLine => ({ key: crypto.randomUUID(), medicineId: "", batchNo: "", expiry: "", qty: "", freeQty: "", rate: "", mrp: "", poItemId: null, verified: false });

function Receive({ po, orders, catalogue, suppliers, scans, ocr, today }: { po: Order | null; orders: Order[]; catalogue: Cat[]; suppliers: Sup[]; scans: Scan[]; ocr: boolean; today: string }) {
  const toast = useToast();
  const router = useRouter();
  const [sup, setSup] = useState(po?.supplierId ?? ""), [poId, setPoId] = useState(po?.id ?? "");
  const [inv, setInv] = useState(""), [date, setDate] = useState(today), [stated, setStated] = useState("");
  const [doc, setDoc] = useState<{ id: string; mime: string; name: string } | null>(null);
  const [lines, setLines] = useState<RLine[]>(() => po ? po.items.filter((i) => i.received < i.qty).map((i) => ({ ...blank(), medicineId: i.medicineId, qty: String(i.qty - i.received), rate: (i.rate / 100).toFixed(2), mrp: ((catalogue.find((c) => c.id === i.medicineId)?.mrp ?? 0) / 100).toFixed(2), poItemId: i.id })) : [blank()]);
  const [pending, start] = useTransition();
  const [uploading, setUploading] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const openPos = orders.filter((o) => o.supplierId === sup && (o.status === "ordered" || o.status === "partially_received"));

  const set = (key: string, p: Partial<RLine>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...p } : l)));
  const flagsOf = (l: RLine) => {
    const f: string[] = [];
    const m = catalogue.find((c) => c.id === l.medicineId);
    if (!m) f.push("No catalogue match");
    if (!l.batchNo.trim()) f.push("Batch missing");
    if (!l.expiry) f.push("Expiry missing"); else if (daysTo(l.expiry.length === 7 ? l.expiry + "-28" : l.expiry) <= 0) f.push("Already expired");
    if (!(parseInt(l.qty) > 0)) f.push("Invalid quantity");
    if (!(toPaise(l.rate) > 0)) f.push("Invalid rate");
    if (!(toPaise(l.mrp) > 0)) f.push("MRP missing"); else if (toPaise(l.rate) > toPaise(l.mrp)) f.push("Rate above MRP");
    if (l.confidence != null && l.confidence < LOW_CONFIDENCE && !l.verified) f.push("Low confidence: confirm");
    if (lines.some((x) => x.key !== l.key && x.medicineId === l.medicineId && x.batchNo.trim().toUpperCase() === l.batchNo.trim().toUpperCase() && l.batchNo)) f.push("Duplicate line");
    return f;
  };
  const t = useMemo(() => grnTotals(lines.map((l) => ({ qty: parseInt(l.qty) || 0, rate: toPaise(l.rate), gstRate: catalogue.find((c) => c.id === l.medicineId)?.gstRate ?? 0 }))), [lines, catalogue]);
  const flagged = lines.filter((l) => flagsOf(l).length).length;
  const statedP = stated ? toPaise(stated) : null;
  const diff = statedP == null ? null : statedP - t.total;
  const match = diff != null && Math.abs(diff) <= 100;
  const canApprove = !!sup && !!inv.trim() && lines.length > 0 && !flagged && match;

  const upload = async (f: File) => {
    setUploading(true);
    const fd = new FormData(); fd.append("file", f);
    const r = await uploadInvoiceAction(fd);
    setUploading(false);
    if (!r.ok) return toast(r.error, "red");
    setDoc({ id: r.data.id, mime: r.data.mime, name: r.data.name });
    if (r.data.extracted) applyExtracted(r.data.extracted);
    else if (r.data.ocrError) toast(`OCR failed: ${r.data.ocrError} Enter the lines by hand.`, "amber");
  };
  const applyExtracted = (x: NonNullable<Scan["extracted"]>) => {
    if (!x.lines?.length && !x.invoiceNo) return;
    if (x.invoiceNo) setInv(x.invoiceNo);
    if (x.invoiceDate && /^\d{4}-\d{2}-\d{2}$/.test(x.invoiceDate)) setDate(x.invoiceDate);
    if (x.total) setStated(String(x.total));
    if (x.lines?.length) {
      setLines(x.lines.map((l, ocrIndex) => ({ ...blank(), ocrIndex, medicineId: l.medicineId ?? "", batchNo: (l.batch ?? "").toUpperCase(), expiry: l.expiry?.slice(0, 7) ?? "", qty: l.qty ? String(l.qty) : "", freeQty: l.freeQty ? String(l.freeQty) : "", rate: l.rate ? String(l.rate) : "", mrp: l.mrp ? String(l.mrp) : "", text: l.text, confidence: l.confidence })));
      toast(`Extracted ${x.lines.length} lines. Check every flagged line against the invoice.`, "blue");
    }
  };
  const resume = (s: Scan) => { setDoc({ id: s.id, mime: s.mime, name: s.name }); if (s.extracted) applyExtracted(s.extracted); };
  const discard = (s: Scan) => {
    const reason = prompt(`Discard ${s.name}? It leaves the review queue (the file is kept for audit). Reason:`, "");
    if (reason === null) return;
    if (reason.trim().length < 3) return toast("Enter a reason.", "red");
    start(async () => { const r = await discardScanAction(s.id, reason); toast(r.ok ? r.message! : r.error, r.ok ? "green" : "red"); if (r.ok && doc?.id === s.id) setDoc(null); });
  };

  const approve = () => start(async () => {
    const r = await postGrnAction({
      supplierId: sup, invoiceNo: inv, invoiceDate: date, statedTotal: stated, poId: poId || null, scanDocId: doc?.id ?? null,
      lines: lines.map((l) => ({ medicineId: l.medicineId, batchNo: l.batchNo, expiry: l.expiry, qty: l.qty, freeQty: l.freeQty || "0", rate: l.rate, mrp: l.mrp, poItemId: l.poItemId, ocrIndex: l.ocrIndex ?? null, verified: l.verified })),
    });
    if (!r.ok) return toast(r.error, "red");
    setDone(`${r.data.grnNo} posted · ${lines.length} batch line(s) · ${inr(r.data.total)} added to ${suppliers.find((s) => s.id === sup)?.name} payable`);
    toast(`${r.data.grnNo} posted. Stock updated.`, "green");
  });

  if (done) return (
    <div className={wrap + " p-8 flex flex-col items-center gap-3 text-center"}>
      <CircleCheck size={40} className="text-ok" /><div className="text-[17px] font-semibold">GRN posted</div><div className="text-[13.5px] text-muted">{done}</div>
      <div className="flex gap-2"><Button onClick={() => router.replace("/app/purchases")}>Back to orders</Button><Button variant="primary" onClick={() => router.replace("/app/purchases?tab=receive&n=" + Date.now())}>Receive another invoice</Button></div>
    </div>
  );

  return (
    <div className="flex flex-col gap-3.5">
      <div className={wrap + " p-4 grid gap-2.5 grid-cols-[repeat(auto-fit,minmax(170px,1fr))]"}>
        <Field label="Supplier"><Select value={sup} onChange={(e) => { setSup(e.target.value); setPoId(""); }}><option value="">Choose…</option>{suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</Select></Field>
        <Field label="Invoice no."><input className={cell + " h-[38px] text-[14px]"} value={inv} onChange={(e) => setInv(e.target.value)} /></Field>
        <Field label="Invoice date"><input type="date" max={today} className={cell + " h-[38px] text-[14px]"} value={date} onChange={(e) => setDate(e.target.value)} /></Field>
        <Field label="Total printed on invoice ₹"><input className={cell + " h-[38px] text-[14px]"} value={stated} onChange={(e) => setStated(e.target.value.replace(/[^\d.]/g, ""))} inputMode="decimal" /></Field>
        <Field label="Against PO"><Select value={poId} onChange={(e) => { const p = orders.find((o) => o.id === e.target.value); if (p) router.replace(`/app/purchases?tab=receive&po=${p.id}`); else setPoId(""); }}><option value="">None</option>{openPos.map((o) => <option key={o.id} value={o.id}>{o.no}</option>)}</Select></Field>
      </div>

      <div className="grid gap-3.5 grid-cols-[minmax(260px,360px)_minmax(0,1fr)] max-[1100px]:grid-cols-1 items-start">
        <div className={wrap + " p-3 flex flex-col gap-2 min-h-[200px]"}>
          <div className="flex items-center justify-between"><span className="font-semibold text-[14px]">Invoice document</span>{doc ? <span className="text-[12px] text-faint truncate max-w-[180px]">{doc.name}</span> : null}</div>
          {doc ? (doc.mime === "application/pdf"
            ? <iframe src={`/api/documents/${doc.id}`} title="Invoice" className="w-full h-[460px] border border-line rounded-lg" />
            // eslint-disable-next-line @next/next/no-img-element
            : <img src={`/api/documents/${doc.id}`} alt="Invoice" className="w-full border border-line rounded-lg" />) : (
            <label className="flex-1 flex flex-col items-center justify-center gap-2 border-2 border-dashed border-input rounded-lg p-5 text-center cursor-pointer hover:border-teal">
              {uploading ? <ScanLine size={26} className="text-teal animate-pulse" /> : <Upload size={26} className="text-teal-border" />}
              <span className="text-[13.5px] font-medium">{uploading ? "Uploading…" : "Upload the supplier invoice"}</span>
              <span className="text-[12px] text-faint">PDF or photo, up to 10 MB. Stored on your server.{ocr ? " Lines are extracted for you to check." : " No OCR engine is set up, so enter the lines beside it."}</span>
              <input type="file" accept="application/pdf,image/jpeg,image/png,image/webp" className="hidden" disabled={uploading} onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); }} />
            </label>
          )}
          <span className="text-[11.5px] text-faint">Optional, but keeping the invoice with the GRN helps audits.</span>
          {doc ? <Button size="sm" variant="danger-outline" className="self-start" disabled={pending} onClick={() => discard({ id: doc.id, name: doc.name, mime: doc.mime, at: "", by: "", extracted: null })}>Discard this invoice</Button> : null}
          {!doc && scans.length ? (
            <div className="flex flex-col gap-1 border-t border-row pt-2">
              <span className="text-[12.5px] font-semibold">Uploaded, awaiting review ({scans.length})</span>
              {scans.map((s) => (
                <div key={s.id} className="flex items-center gap-2 text-[12.5px]">
                  <span className="flex-1 min-w-0 truncate" title={s.name}>{s.name} <span className="text-faint">· {dayMonth(new Date(s.at))}{s.by ? ` · ${s.by}` : ""}</span></span>
                  <Button size="sm" onClick={() => resume(s)}>Open</Button>
                  <Button size="sm" variant="ghost" disabled={pending} onClick={() => discard(s)} aria-label={`Discard ${s.name}`}><Trash2 size={13} /></Button>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        <div className={wrap + " overflow-auto"}>
          <table className="w-full border-collapse min-w-[1000px] text-[13px]">
            <thead><tr className="bg-subtle"><th className={th}>Medicine</th><th className={th}>Batch</th><th className={th}>Expiry</th><th className={th}>Qty</th><th className={th}>Free</th><th className={th}>Rate ex-GST</th><th className={th}>MRP</th><th className={th}>GST</th><th className={th + " text-right"}>Amount</th><th className={th} /></tr></thead>
            <tbody>
              {lines.map((l) => {
                const f = flagsOf(l), m = catalogue.find((c) => c.id === l.medicineId);
                const amt = (parseInt(l.qty) || 0) * toPaise(l.rate);
                return (
                  <FragmentRow key={l.key}>
                    <tr style={{ background: f.length ? "#FFFBF5" : undefined }}>
                      <td className={td + " min-w-[200px]"}>
                        <select className={cell} value={l.medicineId} aria-label="Medicine" onChange={(e) => { const c = catalogue.find((x) => x.id === e.target.value); set(l.key, { medicineId: e.target.value, mrp: l.mrp || (c ? (c.mrp / 100).toFixed(2) : ""), rate: l.rate || (c?.lastRate ? (c.lastRate / 100).toFixed(2) : "") }); }}>
                          <option value="">Choose…</option>{catalogue.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
                        </select>
                        {l.text ? <div className="text-[11px] text-faint font-mono mt-1 truncate max-w-[260px]" title={l.text}>“{l.text}”</div> : null}
                      </td>
                      <td className={td}><input className={cell + " font-mono uppercase w-28"} value={l.batchNo} onChange={(e) => set(l.key, { batchNo: e.target.value.toUpperCase() })} aria-label="Batch" /></td>
                      <td className={td}><input type="month" className={cell + " w-[130px]"} value={l.expiry} onChange={(e) => set(l.key, { expiry: e.target.value })} aria-label="Expiry" /></td>
                      <td className={td}><input className={cell + " w-[72px]"} value={l.qty} onChange={(e) => set(l.key, { qty: e.target.value.replace(/\D/g, "") })} inputMode="numeric" aria-label="Qty" /></td>
                      <td className={td}><input className={cell + " w-14"} value={l.freeQty} onChange={(e) => set(l.key, { freeQty: e.target.value.replace(/\D/g, "") })} inputMode="numeric" aria-label="Free qty" placeholder="0" /></td>
                      <td className={td}><input className={cell + " w-24"} value={l.rate} onChange={(e) => set(l.key, { rate: e.target.value.replace(/[^\d.]/g, "") })} inputMode="decimal" aria-label="Rate" /></td>
                      <td className={td}><input className={cell + " w-24"} value={l.mrp} onChange={(e) => set(l.key, { mrp: e.target.value.replace(/[^\d.]/g, "") })} inputMode="decimal" aria-label="MRP" /></td>
                      <td className={td + " text-muted"}>{m ? m.gstRate + "%" : "—"}</td>
                      <td className={td + " text-right tnum"}>{inr(amt)}</td>
                      <td className={td}><button onClick={() => setLines(lines.filter((x) => x.key !== l.key))} aria-label="Remove line" className="text-fainter hover:text-bad cursor-pointer"><Trash2 size={15} /></button></td>
                    </tr>
                    {f.length || l.confidence != null ? (
                      <tr style={{ background: f.length ? "#FFFBF5" : undefined }}><td colSpan={10} className="px-3 pb-2 pt-0 border-b border-row">
                        <div className="flex gap-3 items-center text-[12px] flex-wrap">
                          {l.confidence != null ? <Badge tone={l.confidence >= 0.9 ? "green" : l.confidence >= LOW_CONFIDENCE ? "amber" : "red"}>{Math.round(l.confidence * 100)}% confidence</Badge> : null}
                          {f.length ? <span className="text-warn flex items-center gap-1"><CircleAlert size={13} />{f.join(" · ")}</span> : null}
                          {l.confidence != null && l.confidence < LOW_CONFIDENCE ? <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" className="accent-teal" checked={l.verified} onChange={(e) => set(l.key, { verified: e.target.checked })} />Verified against the invoice</label> : null}
                        </div>
                      </td></tr>
                    ) : null}
                  </FragmentRow>
                );
              })}
            </tbody>
          </table>
          <div className="p-3"><Button size="sm" onClick={() => setLines([...lines, blank()])}><Plus size={14} />Add line</Button></div>
        </div>
      </div>

      <div className={wrap + " p-4 flex flex-wrap gap-x-8 gap-y-2 items-center"}>
        <div className="text-[13.5px]">Taxable <strong className="tnum">{inr(t.taxable)}</strong></div>
        <div className="text-[13.5px]">GST <strong className="tnum">{inr(t.gst)}</strong></div>
        <div className="text-[13.5px]">Calculated <strong className="tnum">{inr(t.total)}</strong></div>
        <div className="text-[13.5px]">Printed <strong className="tnum">{statedP == null ? "—" : inr(statedP)}</strong></div>
        <Badge tone={statedP == null ? "gray" : match ? "green" : "red"}>{statedP == null ? "Enter the printed total" : match ? (diff ? `Totals match (round-off ${inr(diff!)})` : "Totals match") : `Difference ${inr(diff!)}`}</Badge>
        <span className="text-[13px]" style={{ color: flagged ? "#94570A" : "#1E7F4F" }}>{flagged ? `${flagged} line${flagged > 1 ? "s" : ""} need attention` : "All lines validated"}</span>
        <Button variant="primary" className="ml-auto" disabled={!canApprove || pending} onClick={approve} title={canApprove ? "" : "Resolve flagged lines and match the printed total first"}>Approve & post GRN</Button>
      </div>
      <div className="text-[12px] text-faint">Approval stays locked until every line is complete and the calculated total matches the invoice (within ₹1 round-off). Nothing changes in stock or accounts until you approve.</div>
    </div>
  );
}

