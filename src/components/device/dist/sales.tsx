"use client";
import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, ClipboardList, PackageCheck, Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { deviceDb } from "@/drivedb/device";
import { inr } from "@/lib/money";
import { useT } from "@/lib/i18n-client";
import { card, input, label, errText, type Cfg, type Who } from "../ui";
import { ChemistPicker, InvoiceModal, LineEditor, newKey, type Chemist, type Line } from "./common";

type Quote = { lines: { medicineId: string; name: string; qty: number; rate: number; discPct: number; freeQty: number; scheme: string | null; gstRate: number; problem: string | null }[]; inter: boolean; total: number; taxable: number; tax: number; balancePaise: number; limitPaise: number; status: string };

/** Live price of a bill or order to a chemist: rate, scheme, GST and total. */
function useQuote(chem: Chemist | null, lines: Line[]) {
  const dev = deviceDb();
  const [q, setQ] = useState<Quote | null>(null);
  const live = !!chem && lines.length > 0;
  useEffect(() => {
    if (!chem || !lines.length) return;
    const h = setTimeout(() => { dev.call("distQuote", chem.id, lines.map((l) => ({ medicineId: l.medicineId, qty: l.qty }))).then(setQ, () => setQ(null)); }, 200);
    return () => clearTimeout(h);
  }, [dev, chem, lines]);
  return live ? q : null;
}

function QuoteTable({ q }: { q: Quote }) {
  const t = useT();
  return (
    <div className="text-sm flex flex-col gap-1">
      {q.lines.map((l) => <div key={l.medicineId} className="flex justify-between gap-2"><span>{l.name} × {l.qty}{l.freeQty ? ` + ${l.freeQty} ${t("free")}` : ""}{l.scheme ? ` · ${l.scheme}` : ""}{l.discPct ? ` · ${l.discPct}%` : ""}</span><span className={l.problem ? "text-bad" : ""}>{l.problem ? t(l.problem) : `${inr(l.rate)} · GST ${l.gstRate}%`}</span></div>)}
      <div className="flex justify-between border-t border-line pt-1 font-semibold"><span>{t("Total")} ({q.inter ? "IGST" : "CGST + SGST"})</span><span>{inr(q.total)}</span></div>
      <div className="text-muted text-[13px]">{t("Owes now {due} · credit limit {limit}", { due: inr(q.balancePaise), limit: inr(q.limitPaise) })}</div>
    </div>
  );
}

/** A counter or phone bill to a chemist (no order first). */
export function Wholesale({ cfg, who }: { cfg: Cfg; who: Who }) {
  const toast = useToast();
  const t = useT();
  const dev = deviceDb();
  const [chem, setChem] = useState<Chemist | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [reason, setReason] = useState("");
  const [key, setKey] = useState(newKey);
  const [shown, setShown] = useState<string | null>(null);
  const q = useQuote(chem, lines);
  const save = async () => {
    if (!chem) return;
    try {
      const r = await dev.call("distDirectInvoice", { branchId: cfg.branchId, customerId: chem.id, userId: who.userId, idempotencyKey: key, canOverride: who.owner, overrideReason: reason, lines: lines.filter((l) => l.qty > 0).map((l) => ({ medicineId: l.medicineId, qty: l.qty })) });
      toast(t("Invoice {no} saved: {total}.", { no: r.no, total: inr(r.total) }), "green");
      setShown(r.invoiceId); setLines([]); setChem(null); setReason(""); setKey(newKey());
    } catch (e) { toast(errText(e), "red"); }
  };
  return (
    <div className={`${card} max-w-3xl`}>
      <div className="font-semibold">{t("Wholesale bill")}</div>
      <ChemistPicker value={chem} onChange={setChem} />
      {chem && <LineEditor branchId={cfg.branchId} lines={lines} setLines={setLines} />}
      {q && <QuoteTable q={q} />}
      {who.owner && chem && <label className={label}>{t("Reason, if this goes over the chemist’s credit or below their rate")}<input className={input} value={reason} onChange={(e) => setReason(e.target.value)} /></label>}
      <Button variant="primary" className="self-start" disabled={!chem || !lines.some((l) => l.qty > 0)} onClick={save}>{t("Save invoice")}</Button>
      <InvoiceModal id={shown} onClose={() => setShown(null)} />
    </div>
  );
}

type Order = { id: string; no: string; chemist: string; customerId: string; status: string; estimatePaise: number; at: string; source: string };
type Pick = { id: string; name: string; batchNo: string; expiryDate: string; rack: string | null; units: number; paidUnits: number; pickedUnits: number | null };
const STATUS: Record<string, string> = { pending: "Awaiting approval", approved: "Approved", picking: "Picking", packed: "Packed", invoiced: "Invoiced", dispatched: "Out for delivery", delivered: "Delivered", cancelled: "Cancelled", rejected: "Rejected" };

/** Orders from the office, phone, salesmen and the chemist portal: approve, pick, pack and invoice. */
export function DistOrders({ cfg, who }: { cfg: Cfg; who: Who }) {
  const toast = useToast();
  const t = useT();
  const dev = deviceDb();
  const [open, setOpen] = useState(true);
  const [rows, setRows] = useState<Order[]>([]);
  const [adding, setAdding] = useState(false);
  const [picking, setPicking] = useState<Order | null>(null);
  const [shown, setShown] = useState<string | null>(null);
  const load = useCallback(() => dev.call("distOrders", { open }).then((r) => setRows(r as Order[]), () => setRows([])), [dev, open]);
  useEffect(() => { void load(); }, [load]);
  const act = async (fn: () => Promise<unknown>, ok: string) => { try { await fn(); toast(ok, "green"); void load(); } catch (e) { toast(errText(e), "red"); } };
  const approve = (o: Order) => {
    const partial = confirm(t("If some products are short, cut them to what is in stock? (Cancel to refuse the approval instead.)"));
    const reason = who.owner ? prompt(t("Reason, if the chemist is over credit (leave empty otherwise)")) ?? "" : "";
    void act(() => dev.call("distApproveOrder", { orderId: o.id, userId: who.userId, canOverride: who.owner, overrideReason: reason, allowPartial: partial }), t("Order {no} approved; stock reserved.", { no: o.no }));
  };
  const why = (msg: string) => prompt(t(msg)) ?? "";
  return (
    <div className={card}>
      <div className="flex justify-between items-center gap-2 flex-wrap">
        <div className="font-semibold">{t("Orders")}</div>
        <div className="flex gap-3 items-center">
          <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" checked={!open} onChange={(e) => setOpen(!e.target.checked)} /> {t("Show all")}</label>
          <Button variant="primary" onClick={() => setAdding(true)}><Plus size={16} /> {t("New order")}</Button>
        </div>
      </div>
      <ul className="text-sm divide-y divide-line">
        {rows.map((o) => (
          <li key={o.id} className="py-2.5 flex flex-col gap-1.5">
            <div className="flex justify-between gap-2 flex-wrap"><span><b>{o.no}</b> · {o.chemist}{o.source === "portal" ? ` · ${t("portal")}` : ""}</span><span className="text-muted">{t(STATUS[o.status] ?? o.status)} · {inr(o.estimatePaise)}</span></div>
            <div className="flex gap-1.5 flex-wrap">
              {o.status === "pending" && <><Button size="sm" variant="primary" onClick={() => approve(o)}><CheckCircle2 size={14} /> {t("Approve")}</Button>
                <Button size="sm" onClick={() => { const r = why("Reason for the chemist"); if (r) void act(() => dev.call("distRejectOrder", { orderId: o.id, reason: r, userId: who.userId }), t("Order rejected.")); }}>{t("Reject")}</Button></>}
              {(o.status === "approved" || o.status === "picking") && <Button size="sm" variant="primary" onClick={() => setPicking(o)}><ClipboardList size={14} /> {t("Pick list")}</Button>}
              {o.status === "packed" && <Button size="sm" variant="primary" onClick={() => act(async () => { const r = await dev.call("distInvoiceOrder", { orderId: o.id, userId: who.userId }); setShown(r.invoiceId); }, t("Invoice raised."))}><PackageCheck size={14} /> {t("Invoice")}</Button>}
              {["pending", "approved", "picking", "packed"].includes(o.status) && <Button size="sm" variant="danger-outline" onClick={() => { const r = why("Why is it cancelled?"); void act(() => dev.call("distCancelOrder", { orderId: o.id, reason: r, userId: who.userId }), t("Order cancelled.")); }}><X size={14} /> {t("Cancel")}</Button>}
            </div>
          </li>
        ))}
        {!rows.length && <li className="py-3 text-muted">{t("No orders.")}</li>}
      </ul>
      <NewOrder open={adding} cfg={cfg} who={who} onClose={() => { setAdding(false); void load(); }} />
      <PickModal order={picking} who={who} onClose={() => { setPicking(null); void load(); }} />
      <InvoiceModal id={shown} onClose={() => setShown(null)} />
    </div>
  );
}

function NewOrder({ open, cfg, who, onClose }: { open: boolean; cfg: Cfg; who: Who; onClose: () => void }) {
  const toast = useToast();
  const t = useT();
  const dev = deviceDb();
  const [chem, setChem] = useState<Chemist | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [note, setNote] = useState("");
  const [key, setKey] = useState(newKey);
  const q = useQuote(chem, lines);
  const save = async () => {
    if (!chem) return;
    try {
      const r = await dev.call("distPlaceOrder", { branchId: cfg.branchId, customerId: chem.id, userId: who.userId, source: "phone", note, idempotencyKey: key, lines: lines.filter((l) => l.qty > 0).map((l) => ({ medicineId: l.medicineId, qty: l.qty })) });
      toast(r.creditOk ? t("Order {no} booked.", { no: r.no }) : t("Order {no} booked, on credit hold: {why}", { no: r.no, why: r.reasons.join(" ") }), r.creditOk ? "green" : "amber");
      setChem(null); setLines([]); setNote(""); setKey(newKey()); onClose();
    } catch (e) { toast(errText(e), "red"); }
  };
  return (
    <Modal open={open} onClose={onClose} width={640} title={t("New order")} footer={<Button variant="primary" disabled={!chem || !lines.length} onClick={save}>{t("Book order")}</Button>}>
      <div className="flex flex-col gap-3">
        <ChemistPicker value={chem} onChange={setChem} />
        {chem && <LineEditor branchId={cfg.branchId} lines={lines} setLines={setLines} />}
        {q && <QuoteTable q={q} />}
        <label className={label}>{t("Note")}<input className={input} value={note} onChange={(e) => setNote(e.target.value)} /></label>
      </div>
    </Modal>
  );
}

function PickModal({ order, who, onClose }: { order: Order | null; who: Who; onClose: () => void }) {
  const toast = useToast();
  const t = useT();
  const dev = deviceDb();
  const [rows, setRows] = useState<Pick[]>([]);
  const [typed, setTyped] = useState<Record<string, string>>({});
  const [boxes, setBoxes] = useState("1");
  const load = useCallback(() => { if (order) dev.call("distPickList", order.id).then((r) => setRows(r as Pick[]), () => setRows([])); }, [dev, order]);
  useEffect(() => { load(); }, [load]);
  const run = async (fn: () => Promise<unknown>) => { try { await fn(); load(); } catch (e) { toast(errText(e), "red"); } };
  return (
    <Modal open={!!order} onClose={onClose} width={680} title={order ? t("Pick list · {no}", { no: order.no }) : ""}
      footer={<div className="flex gap-2 items-center"><input className={`${input} w-20`} value={boxes} onChange={(e) => setBoxes(e.target.value.replace(/\D/g, ""))} aria-label={t("Boxes")} /><span className="text-sm">{t("boxes")}</span>
        <Button variant="primary" onClick={() => order && run(async () => { await dev.call("distPackOrder", { orderId: order.id, boxes: Number(boxes) || 0, userId: who.userId }); toast(t("Packed. Ready to invoice."), "green"); onClose(); })}>{t("Packed")}</Button></div>}>
      <table className="w-full text-sm"><thead><tr className="text-left text-muted"><th>{t("Rack")}</th><th>{t("Product")}</th><th>{t("Batch")}</th><th className="text-right">{t("Units")}</th><th>{t("Picked")}</th></tr></thead>
        <tbody>{rows.map((p) => (
          <tr key={p.id} className="border-t border-line"><td>{p.rack ?? "—"}</td><td>{p.name}</td><td>{p.batchNo} · {p.expiryDate.slice(0, 7)}</td><td className="text-right">{p.units}</td>
            <td>{p.pickedUnits != null ? <b>{p.pickedUnits}</b> : <span className="flex gap-1"><input className={`${input} w-20`} placeholder={String(p.units)} value={typed[p.id] ?? ""} onChange={(e) => setTyped({ ...typed, [p.id]: e.target.value.replace(/\D/g, "") })} aria-label={t("Picked units of {name}", { name: p.name })} />
              <Button size="sm" onClick={() => run(() => dev.call("distConfirmPick", { pickLineId: p.id, pickedUnits: typed[p.id] === undefined || typed[p.id] === "" ? p.units : Number(typed[p.id]), userId: who.userId }))}>{t("OK")}</Button></span>}</td></tr>
        ))}</tbody></table>
    </Modal>
  );
}
