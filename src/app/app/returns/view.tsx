"use client";
import { useEffect, useState, useTransition } from "react";
import { Printer, FileDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { inr, inr0 } from "@/lib/money";
import { dayMonth, hhmm } from "@/lib/dates";
import { REFUND_MODES } from "@/domain/sales/contracts";
import type { currentShift, recentInvoices, returnableLines, todaysCreditNotes } from "@/domain/sales/returns";
import { closeShiftAction, findInvoicesAction, linesAction, openShiftAction, returnAction, sendCreditNoteAction, voidAction } from "./actions";

type Inv = Awaited<ReturnType<typeof recentInvoices>>[number];
type Lines = NonNullable<Awaited<ReturnType<typeof returnableLines>>>;
const card = "bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] px-[18px] py-4 flex flex-col gap-3";
const inp = "border border-input rounded-lg px-[11px] py-[9px] text-[14px] outline-none bg-white focus:border-teal w-full";

export function ReturnsView({ invoices: initial, creditNotes, shift, canRefund, counter }: {
  invoices: Inv[]; creditNotes: Awaited<ReturnType<typeof todaysCreditNotes>>; shift: Awaited<ReturnType<typeof currentShift>>; canRefund: boolean; counter: string;
}) {
  const toast = useToast();
  const [q, setQ] = useState(""), [invoices, setInvoices] = useState(initial);
  const [sel, setSel] = useState(""), [lines, setLines] = useState<Lines | null>(null);
  const [qty, setQty] = useState<Record<string, string>>({});
  const [cond, setCond] = useState<"sealed" | "damaged">("sealed"), [mode, setMode] = useState<(typeof REFUND_MODES)[number]>("Cash"), [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const [opening, setOpening] = useState(""), [counted, setCounted] = useState("");
  const [voidReason, setVoidReason] = useState("");
  const [issued, setIssued] = useState<{ id: string; creditNote: string; amount: number; mode: string; money?: number; pointsBack?: number; pointsTaken?: number; phone?: string | null } | null>(null);

  useEffect(() => { setInvoices(initial); }, [initial]);
  useEffect(() => { if (!q.trim()) { setInvoices(initial); return; } const h = setTimeout(() => findInvoicesAction(q).then(setInvoices), 250); return () => clearTimeout(h); }, [q, initial]);
  useEffect(() => { setQty({}); setLines(null); setVoidReason(""); if (sel) linesAction(sel).then((l) => { setLines(l); if (l?.payMode === "credit") setMode("Adjust customer credit"); }); }, [sel]);

  const refund = lines ? lines.lines.reduce((a, l) => a + Math.round(l.unitNet * Math.min(Number(qty[l.itemId] || 0), l.sold - l.returned)), 0) : 0;
  const submit = () => start(async () => {
    const r = await returnAction({ saleId: sel, lines: lines!.lines.map((l) => ({ itemId: l.itemId, qty: Number(qty[l.itemId] || 0) })), condition: cond, refundMode: mode, reason });
    if (!r.ok) return toast(r.error, "red");
    setIssued(r.data);
    setReason(""); setQty({}); setLines(await linesAction(sel));
  });

  const o = shift.open;
  const cnt = Math.round((parseFloat(counted) || 0) * 100);
  return (
    <div className="grid gap-4 max-w-[1400px] items-start grid-cols-[minmax(0,1.4fr)_minmax(300px,1fr)] max-[980px]:grid-cols-1">
      <div className={card}>
        <div className="font-semibold text-[15px]">Sales return & refund</div>
        <div className="flex gap-2 flex-wrap">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Invoice no. or customer" aria-label="Find invoice" className={inp + " max-w-[220px] max-sm:max-w-none"} />
          <select value={sel} onChange={(e) => setSel(e.target.value)} aria-label="Invoice" className={inp + " flex-1 min-w-[240px]"}>
            <option value="">{invoices.length ? "Select a committed invoice…" : "No invoices found"}</option>
            {invoices.map((i) => <option key={i.id} value={i.id}>{i.no} · {i.customer} · {inr(i.total)} · {dayMonth(new Date(i.at))} {hhmm(new Date(i.at))}{i.voided ? " · VOID" : ""}</option>)}
          </select>
        </div>
        {lines ? (
          <>
            {lines.voided ? <div role="status" className="text-[13px] text-bad bg-bad-bg rounded-lg px-3 py-2"><strong>VOID</strong> · {dayMonth(new Date(lines.voided.at))} {hhmm(new Date(lines.voided.at))} · {lines.voided.reason}</div> : null}
            <div className="border border-[#E3E6E9] rounded-lg overflow-hidden">
              {lines.lines.map((l) => {
                const max = l.sold - l.returned;
                return (
                  <div key={l.itemId} className="grid grid-cols-[minmax(0,1fr)_auto_80px] gap-3 items-center px-3 py-2.5 border-b border-row last:border-0 text-[13.5px]">
                    <div className="flex flex-col min-w-0"><strong className="font-semibold">{l.name}</strong><span className="text-[12px] text-muted">{l.batchNo} · sold {l.soldText} · returned {l.returned} · {inr(Math.round(l.unitNet))} per {l.unit || "unit"}{l.expired ? " · batch expired" : ""}</span></div>
                    <span className="text-[12px] text-faint whitespace-nowrap">{max ? `max ${max}` : "fully returned"}</span>
                    <input value={qty[l.itemId] ?? ""} onChange={(e) => setQty({ ...qty, [l.itemId]: String(Math.min(Number(e.target.value.replace(/\D/g, "") || 0), max) || "") })} disabled={!max} placeholder="0" aria-label={`Return qty ${l.name}`} inputMode="numeric"
                      className="border border-input rounded-md px-2 py-1.5 text-right text-[14px] disabled:bg-chip" />
                  </div>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
              <select value={cond} onChange={(e) => setCond(e.target.value as typeof cond)} aria-label="Condition" className={inp}><option value="sealed">Sealed, resaleable</option><option value="damaged">Opened or damaged</option></select>
              <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} aria-label="Refund mode" className={inp} disabled={lines.payMode === "credit"}>
                {REFUND_MODES.filter((m) => m !== "Adjust customer credit" || lines.hasCustomer).map((m) => <option key={m}>{m}</option>)}
              </select>
            </div>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (required, kept in audit trail)" aria-label="Reason" className={inp} />
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="text-[14px]">Refund <strong className="text-[18px] tnum">{inr(refund)}</strong></span>
              <Button variant="primary" disabled={!canRefund || !refund || pending} onClick={submit}>Issue credit note</Button>
            </div>
            {!canRefund ? <div className="text-[12.5px] text-bad">Your role cannot approve refunds. A manager must process this.</div> : null}
            <div className="text-[12px] text-faint">Refunds are the amount actually paid (after discount), with GST reversed. Sealed returns go back to the same batch. Opened or damaged items are not restocked. Expired stock is never resold.</div>
            {lines.canVoid && canRefund ? (
              <div className="flex flex-col gap-2 border-t border-line-soft pt-3">
                <div className="text-[13.5px] font-semibold">Void the whole bill</div>
                <div className="text-[12px] text-muted">Only for today’s bills with nothing returned. Every item goes back to its batch and each payment is refunded the way it was paid ({lines.payMode === "credit" ? "taken off the customer’s balance" : lines.payMode.toUpperCase()}). The invoice keeps its number and is marked VOID.</div>
                <div className="flex gap-2 flex-wrap">
                  <input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder="Reason for voiding (required)" aria-label="Void reason" className={inp + " flex-1 min-w-[200px]"} />
                  <Button className="text-bad" disabled={pending || voidReason.trim().length < 3} onClick={() => {
                    if (!confirm(`Void ${lines.no} and refund ${inr(lines.total)}?`)) return;
                    start(async () => {
                      const r = await voidAction(sel, voidReason);
                      if (!r.ok) return toast(r.error, "red");
                      toast(`${r.data.invoiceNo} voided. Refund ${r.data.refunds.map((x) => `${x.mode === "credit" ? "credit" : x.mode.toUpperCase()} ${inr(x.amountPaise)}`).join(" + ")}.`, "green");
                      setVoidReason(""); setLines(await linesAction(sel)); setInvoices(await findInvoicesAction(q));
                    });
                  }}>Void bill</Button>
                </div>
              </div>
            ) : null}
          </>
        ) : null}
        {creditNotes.length ? (
          <div className="flex flex-col gap-1 border-t border-line-soft pt-3">
            <div className="text-[12.5px] text-muted font-medium">Credit notes today</div>
            {creditNotes.map((c) => (
              <div key={c.no} className="grid grid-cols-[auto_minmax(0,1fr)_auto] max-sm:grid-cols-[auto_auto] max-sm:justify-between max-sm:gap-y-0.5 gap-3 py-1.5 border-b border-row text-[13px] items-baseline">
                <a href={`/print/credit-note/${c.id}?format=a4`} target="_blank" rel="noreferrer" className="font-mono text-[12px] text-teal font-medium no-underline hover:underline">{c.no}</a><span className="truncate max-sm:col-span-2 max-sm:order-last">{c.customer} <span className="text-muted">· {c.invoice} · {c.reason} · {c.mode}</span></span><strong className="tnum">{inr(c.amount)}</strong>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className={card}>
        <div className="font-semibold text-[15px]">Shift · {counter}</div>
        {o ? (
          <>
            <div className="text-[12.5px] text-muted">Opened {dayMonth(new Date(o.openedAt))} {hhmm(new Date(o.openedAt))}</div>
            {[["Opening float", o.open], ["Cash sales", o.cash], ...(o.cod ? [["Delivery cash handed over", o.cod] as const] : []), ["Cash refunds", -o.refunds], ["Cash expenses", -o.expenses]].map(([k, v]) => (
              <div key={k as string} className="flex justify-between text-[13.5px]"><span className="text-muted">{k}</span><span className="tnum">{inr(v as number)}</span></div>
            ))}
            <div className="flex justify-between text-[14px] font-semibold border-t border-[#E3E6E9] pt-2"><span>Expected in drawer</span><span className="tnum">{inr(o.expected)}</span></div>
            <label className="flex flex-col gap-1 text-[12.5px] text-muted font-medium">Counted cash (₹)<input value={counted} onChange={(e) => setCounted(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0.00" inputMode="decimal" className={inp + " text-[15px]"} /></label>
            {counted ? <div className="text-[13px] font-medium" style={{ color: cnt === o.expected ? "#1E7F4F" : "#B3261E" }}>{cnt === o.expected ? "Drawer matches." : `Difference ${inr(cnt - o.expected)} (${cnt < o.expected ? "short" : "excess"})`}</div> : null}
            <Button variant="primary" disabled={pending} onClick={() => start(async () => {
              const r = await closeShiftAction(counted);
              if (!r.ok) return toast(r.error, "red");
              toast(r.data.diff ? `Shift closed. Difference ${inr(r.data.diff)} posted to Cash short/excess.` : "Shift closed. Drawer matches.", r.data.diff ? "amber" : "green"); setCounted("");
            })}>Close shift & post</Button>
          </>
        ) : (
          <>
            <div className="text-[13px] text-muted">No shift open on this counter. Cash sales are tracked against a shift so the drawer can be reconciled.</div>
            <label className="flex flex-col gap-1 text-[12.5px] text-muted font-medium">Opening float (₹)<input value={opening} onChange={(e) => setOpening(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0.00" inputMode="decimal" className={inp} /></label>
            <Button variant="primary" disabled={pending} onClick={() => start(async () => { const r = await openShiftAction(opening || "0"); if (!r.ok) return toast(r.error, "red"); toast("Shift opened.", "green"); setOpening(""); })}>Open shift</Button>
            {shift.last ? <div className="text-[12.5px] text-muted">Last shift closed {dayMonth(new Date(shift.last.closedAt))} {hhmm(new Date(shift.last.closedAt))} · expected {inr(shift.last.expected)} · counted {inr(shift.last.counted)}{shift.last.counted !== shift.last.expected ? <span className="font-medium" style={{ color: shift.last.counted < shift.last.expected ? "#B3261E" : "#1E7F4F" }}> · {inr0(Math.abs(shift.last.counted - shift.last.expected))} {shift.last.counted < shift.last.expected ? "short" : "over"}</span> : null}</div> : null}
          </>
        )}
        <div className="text-[12px] text-faint">Any difference is posted to Cash short/excess and shows in the audit trail.</div>
      </div>
      <Modal open={!!issued} onClose={() => setIssued(null)} title={issued ? `Credit note ${issued.creditNote} issued` : ""} sub={issued ? `Refund ${inr(issued.amount)} · ${issued.mode}${issued.money !== undefined && issued.money < issued.amount ? ` (${inr(issued.money)} paid, ${issued.pointsBack} points given back)` : ""}${issued.pointsTaken ? ` · ${issued.pointsTaken} earned points taken back` : ""}` : ""}
        footer={<Button variant="primary" onClick={() => setIssued(null)} autoFocus>Done</Button>}>
        {issued ? (
          <>
            <div className="flex gap-2">
              <Button className="flex-1 h-10" onClick={() => printCreditNote(issued.id, "thermal", toast)}><Printer size={16} />Thermal 80mm</Button>
              <Button className="flex-1 h-10" onClick={() => printCreditNote(issued.id, "a4", toast)}><FileDown size={16} />A4 / PDF</Button>
            </div>
            <SendCreditNote id={issued.id} phone={issued.phone ?? ""} />
          </>
        ) : null}
      </Modal>
    </div>
  );
}

function SendCreditNote({ id, phone: initial }: { id: string; phone: string }) {
  const toast = useToast();
  const [phone, setPhone] = useState(initial), [ok, setOk] = useState(false), [sent, setSent] = useState(false);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-2 border border-[#CFE6D8] bg-[#F6FBF8] rounded-[10px] p-3 mt-1">
      <div className="text-[13.5px] font-semibold">Send on WhatsApp</div>
      <input value={phone} onChange={(e) => { setPhone(e.target.value.replace(/[^\d ]/g, "")); setOk(false); }} disabled={sent} placeholder="Customer mobile (10 digits)" aria-label="WhatsApp number for credit note" className={inp} />
      <Checkbox checked={ok} disabled={sent} onChange={(e) => setOk(e.target.checked)} label="I read the number back to the customer and they consent" />
      <Button disabled={!ok || pending || sent} onClick={() => start(async () => { const r = await sendCreditNoteAction(id, phone, ok); if (!r.ok) return toast(r.error, "red"); setSent(true); toast("Credit note sent on WhatsApp.", "green"); })}>{sent ? "Sent" : pending ? "Sending…" : "Send credit note"}</Button>
    </div>
  );
}

function printCreditNote(id: string, format: "thermal" | "a4", toast: ReturnType<typeof useToast>) {
  // "noopener" in the features makes window.open return null even when the tab opened.
  const w = window.open(`/print/credit-note/${id}?format=${format}`, "_blank");
  if (!w) toast("Allow pop-ups to print credit notes.", "amber");
  else w.opener = null;
}
