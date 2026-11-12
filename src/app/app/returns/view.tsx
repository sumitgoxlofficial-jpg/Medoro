"use client";
import { useEffect, useState, useTransition } from "react";
import { Printer, FileDown, FileImage, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/field";
import { Modal } from "@/components/ui/modal";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/lib/i18n-client";
import { inr, inr0 } from "@/lib/money";
import { dayMonth, hhmm } from "@/lib/dates";
import { REFUND_MODES } from "@/domain/sales/contracts";
import type { currentShift, recentInvoices, returnableLines, todaysCreditNotes } from "@/domain/sales/returns";
import { closeShiftAction, findInvoicesAction, linesAction, openShiftAction, returnAction, sendCreditNoteAction, uploadSaleRxAction, voidAction } from "./actions";

type Inv = Awaited<ReturnType<typeof recentInvoices>>[number];
type Lines = NonNullable<Awaited<ReturnType<typeof returnableLines>>>;
const card = "bg-white border border-line rounded-xl shadow-[0_1px_2px_rgba(16,24,40,.04)] px-[18px] py-4 flex flex-col gap-3";
const inp = "border border-input rounded-lg px-[11px] py-[9px] text-[14px] outline-none bg-white focus:border-teal w-full";

export function ReturnsView({ invoices: initial, creditNotes, shift, canRefund, counter }: {
  invoices: Inv[]; creditNotes: Awaited<ReturnType<typeof todaysCreditNotes>>; shift: Awaited<ReturnType<typeof currentShift>>; canRefund: boolean; counter: string;
}) {
  const toast = useToast();
  const t = useT();
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
        <div className="font-semibold text-[15px]">{t("Sales return & refund")}</div>
        <div className="flex gap-2 flex-wrap">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Invoice no. or customer")} aria-label={t("Find invoice")} className={inp + " max-w-[220px] max-sm:max-w-none"} />
          <select value={sel} onChange={(e) => setSel(e.target.value)} aria-label={t("Invoice")} className={inp + " flex-1 min-w-[240px]"}>
            <option value="">{t(invoices.length ? "Select a committed invoice…" : "No invoices found")}</option>
            {invoices.map((i) => <option key={i.id} value={i.id}>{i.no} · {i.customer} · {inr(i.total)} · {dayMonth(new Date(i.at))} {hhmm(new Date(i.at))}{i.voided ? " · VOID" : ""}</option>)}
          </select>
        </div>
        {lines ? (
          <>
            {lines.voided ? <div role="status" className="text-[13px] text-bad bg-bad-bg rounded-lg px-3 py-2"><strong>VOID</strong> · {dayMonth(new Date(lines.voided.at))} {hhmm(new Date(lines.voided.at))} · {lines.voided.reason}</div> : null}
            <div className="flex items-center gap-3 flex-wrap text-[13px]">
              <span className="text-muted">{t("Prescription")}{lines.prescriber ? ` · ${lines.prescriber}` : ""}:</span>
              {lines.hasRx ? <a href={`/api/sales/${lines.id}/rx`} target="_blank" rel="noreferrer" className="text-teal flex items-center gap-1 no-underline"><FileImage size={13} />{t("View")}</a> : null}
              <label className="text-teal flex items-center gap-1 cursor-pointer"><Upload size={13} />{t(lines.hasRx ? "Replace Rx" : "Attach Rx")}<input type="file" accept="image/*,application/pdf" capture="environment" className="hidden" disabled={pending} onChange={(e) => {
                const f = e.target.files?.[0]; e.target.value = "";
                if (!f) return;
                const fd = new FormData(); fd.append("file", f);
                start(async () => { const r = await uploadSaleRxAction(lines.id, fd); if (!r.ok) return toast(r.error, "red"); toast(t("Prescription attached."), "green"); setLines(await linesAction(lines.id)); });
              }} /></label>
            </div>
            <div className="border border-[#E3E6E9] rounded-lg overflow-hidden">
              {lines.lines.map((l) => {
                const max = l.sold - l.returned;
                return (
                  <div key={l.itemId} className="grid grid-cols-[minmax(0,1fr)_auto_80px] gap-3 items-center px-3 py-2.5 border-b border-row last:border-0 text-[13.5px]">
                    <div className="flex flex-col min-w-0"><strong className="font-semibold">{l.name}</strong><span className="text-[12px] text-muted">{l.batchNo} · {t("sold {qty}", { qty: l.soldText })} · {t("returned {n}", { n: l.returned })} · {t("{price} per {unit}", { price: inr(Math.round(l.unitNet)), unit: l.unit || t("unit") })}{l.expired ? ` · ${t("batch expired")}` : ""}</span></div>
                    <span className="text-[12px] text-faint whitespace-nowrap">{max ? t("max {n}", { n: max }) : t("fully returned")}</span>
                    <input value={qty[l.itemId] ?? ""} onChange={(e) => setQty({ ...qty, [l.itemId]: String(Math.min(Number(e.target.value.replace(/\D/g, "") || 0), max) || "") })} disabled={!max} placeholder="0" aria-label={t("Return qty {name}", { name: l.name })} inputMode="numeric"
                      className="border border-input rounded-md px-2 py-1.5 text-right text-[14px] disabled:bg-chip" />
                  </div>
                );
              })}
            </div>
            <div className="grid grid-cols-2 gap-2 max-sm:grid-cols-1">
              <select value={cond} onChange={(e) => setCond(e.target.value as typeof cond)} aria-label={t("Condition")} className={inp}><option value="sealed">{t("Sealed, resaleable")}</option><option value="damaged">{t("Opened or damaged")}</option></select>
              <select value={mode} onChange={(e) => setMode(e.target.value as typeof mode)} aria-label={t("Refund mode")} className={inp} disabled={lines.payMode === "credit"}>
                {REFUND_MODES.filter((m) => m !== "Adjust customer credit" || lines.hasCustomer).map((m) => <option key={m} value={m}>{t(m)}</option>)}
              </select>
            </div>
            <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("Reason (required, kept in audit trail)")} aria-label={t("Reason")} className={inp} />
            <div className="flex items-center justify-between gap-3 flex-wrap">
              <span className="text-[14px]">{t("Refund")} <strong className="text-[18px] tnum">{inr(refund)}</strong></span>
              <Button variant="primary" disabled={!canRefund || !refund || pending} onClick={submit}>Issue credit note</Button>
            </div>
            {!canRefund ? <div className="text-[12.5px] text-bad">{t("Your role cannot approve refunds. A manager must process this.")}</div> : null}
            <div className="text-[12px] text-faint">{t("Refunds are the amount actually paid (after discount), with GST reversed. Sealed returns go back to the same batch. Opened or damaged items are not restocked. Expired stock is never resold.")}</div>
            {lines.canVoid && canRefund ? (
              <div className="flex flex-col gap-2 border-t border-line-soft pt-3">
                <div className="text-[13.5px] font-semibold">{t("Void the whole bill")}</div>
                <div className="text-[12px] text-muted">{t("Only for today’s bills with nothing returned. Every item goes back to its batch and each payment is refunded the way it was paid ({how}). The invoice keeps its number and is marked VOID.", { how: lines.payMode === "credit" ? t("taken off the customer’s balance") : lines.payMode.toUpperCase() })}</div>
                <div className="flex gap-2 flex-wrap">
                  <input value={voidReason} onChange={(e) => setVoidReason(e.target.value)} placeholder={t("Reason for voiding (required)")} aria-label={t("Void reason")} className={inp + " flex-1 min-w-[200px]"} />
                  <Button className="text-bad" disabled={pending || voidReason.trim().length < 3} onClick={() => {
                    if (!confirm(t("Void {no} and refund {amount}?", { no: lines.no, amount: inr(lines.total) }))) return;
                    start(async () => {
                      const r = await voidAction(sel, voidReason);
                      if (!r.ok) return toast(r.error, "red");
                      toast(t("{no} voided. Refund {amounts}.", { no: r.data.invoiceNo, amounts: r.data.refunds.map((x) => `${x.mode === "credit" ? t("credit") : x.mode.toUpperCase()} ${inr(x.amountPaise)}`).join(" + ") }), "green");
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
            <div className="text-[12.5px] text-muted font-medium">{t("Credit notes today")}</div>
            {creditNotes.map((c) => (
              <div key={c.no} className="grid grid-cols-[auto_minmax(0,1fr)_auto] max-sm:grid-cols-[auto_auto] max-sm:justify-between max-sm:gap-y-0.5 gap-3 py-1.5 border-b border-row text-[13px] items-baseline">
                <a href={`/print/credit-note/${c.id}?format=a4`} target="_blank" rel="noreferrer" className="font-mono text-[12px] text-teal font-medium no-underline hover:underline">{c.no}</a><span className="truncate max-sm:col-span-2 max-sm:order-last">{c.customer} <span className="text-muted">· {c.invoice} · {c.reason} · {t(c.mode)}</span></span><strong className="tnum">{inr(c.amount)}</strong>
              </div>
            ))}
          </div>
        ) : null}
      </div>

      <div className={card}>
        <div className="font-semibold text-[15px]">{t("Shift · {counter}", { counter })}</div>
        {o ? (
          <>
            <div className="text-[12.5px] text-muted">{t("Opened {when}", { when: `${dayMonth(new Date(o.openedAt))} ${hhmm(new Date(o.openedAt))}` })}</div>
            {[["Opening float", o.open], ["Cash sales", o.cash], ...(o.cod ? [["Delivery cash handed over", o.cod] as const] : []), ["Cash refunds", -o.refunds], ["Cash expenses", -o.expenses]].map(([k, v]) => (
              <div key={k as string} className="flex justify-between text-[13.5px]"><span className="text-muted">{t(k as string)}</span><span className="tnum">{inr(v as number)}</span></div>
            ))}
            <div className="flex justify-between text-[14px] font-semibold border-t border-[#E3E6E9] pt-2"><span>{t("Expected in drawer")}</span><span className="tnum">{inr(o.expected)}</span></div>
            <label className="flex flex-col gap-1 text-[12.5px] text-muted font-medium">{t("Counted cash (₹)")}<input value={counted} onChange={(e) => setCounted(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0.00" inputMode="decimal" className={inp + " text-[15px]"} /></label>
            {counted ? <div className="text-[13px] font-medium" style={{ color: cnt === o.expected ? "#1E7F4F" : "#B3261E" }}>{cnt === o.expected ? t("Drawer matches.") : t(cnt < o.expected ? "Difference {amount} (short)" : "Difference {amount} (excess)", { amount: inr(cnt - o.expected) })}</div> : null}
            <Button variant="primary" disabled={pending} onClick={() => start(async () => {
              const r = await closeShiftAction(counted);
              if (!r.ok) return toast(r.error, "red");
              toast(r.data.diff ? t("Shift closed. Difference {amount} posted to Cash short/excess.", { amount: inr(r.data.diff) }) : "Shift closed. Drawer matches.", r.data.diff ? "amber" : "green"); setCounted("");
            })}>Close shift & post</Button>
          </>
        ) : (
          <>
            <div className="text-[13px] text-muted">{t("No shift open on this counter. Cash sales are tracked against a shift so the drawer can be reconciled.")}</div>
            <label className="flex flex-col gap-1 text-[12.5px] text-muted font-medium">{t("Opening float (₹)")}<input value={opening} onChange={(e) => setOpening(e.target.value.replace(/[^\d.]/g, ""))} placeholder="0.00" inputMode="decimal" className={inp} /></label>
            <Button variant="primary" disabled={pending} onClick={() => start(async () => { const r = await openShiftAction(opening || "0"); if (!r.ok) return toast(r.error, "red"); toast("Shift opened.", "green"); setOpening(""); })}>Open shift</Button>
            {shift.last ? <div className="text-[12.5px] text-muted">{t("Last shift closed {when} · expected {expected} · counted {counted}", { when: `${dayMonth(new Date(shift.last.closedAt))} ${hhmm(new Date(shift.last.closedAt))}`, expected: inr(shift.last.expected), counted: inr(shift.last.counted) })}{shift.last.counted !== shift.last.expected ? <span className="font-medium" style={{ color: shift.last.counted < shift.last.expected ? "#B3261E" : "#1E7F4F" }}> · {t(shift.last.counted < shift.last.expected ? "{amount} short" : "{amount} over", { amount: inr0(Math.abs(shift.last.counted - shift.last.expected)) })}</span> : null}</div> : null}
          </>
        )}
        <div className="text-[12px] text-faint">{t("Any difference is posted to Cash short/excess and shows in the audit trail.")}</div>
      </div>
      <Modal open={!!issued} onClose={() => setIssued(null)} title={issued ? t("Credit note {no} issued", { no: issued.creditNote }) : ""} sub={issued ? `${t("Refund {amount} · {mode}", { amount: inr(issued.amount), mode: t(issued.mode) })}${issued.money !== undefined && issued.money < issued.amount ? ` ${t("({paid} paid, {n} points given back)", { paid: inr(issued.money), n: issued.pointsBack })}` : ""}${issued.pointsTaken ? ` · ${t("{n} earned points taken back", { n: issued.pointsTaken })}` : ""}` : ""}
        footer={<Button variant="primary" onClick={() => setIssued(null)} autoFocus>Done</Button>}>
        {issued ? (
          <>
            <div className="flex gap-2">
              <Button className="flex-1 h-10" onClick={() => printCreditNote(issued.id, "thermal", toast)}><Printer size={16} />{t("Thermal 80mm")}</Button>
              <Button className="flex-1 h-10" onClick={() => printCreditNote(issued.id, "a4", toast)}><FileDown size={16} />{t("A4 / PDF")}</Button>
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
  const t = useT();
  const [phone, setPhone] = useState(initial), [ok, setOk] = useState(false), [sent, setSent] = useState(false);
  const [pending, start] = useTransition();
  return (
    <div className="flex flex-col gap-2 border border-[#CFE6D8] bg-[#F6FBF8] rounded-[10px] p-3 mt-1">
      <div className="text-[13.5px] font-semibold">{t("Send on WhatsApp")}</div>
      <input value={phone} onChange={(e) => { setPhone(e.target.value.replace(/[^\d ]/g, "")); setOk(false); }} disabled={sent} placeholder={t("Customer mobile (10 digits)")} aria-label={t("WhatsApp number for credit note")} className={inp} />
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
