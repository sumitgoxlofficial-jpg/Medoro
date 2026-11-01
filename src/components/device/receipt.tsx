"use client";
import { useEffect } from "react";
import { Printer, MessageCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { inr } from "@/lib/money";
import { dayMonth, hhmm } from "@/lib/dates";
import type { SaleDetail } from "@/drivedb/reports";
import type { Pharmacy } from "@/drivedb/seed";
import { billText, waLink } from "@/drivedb/share";

const exp = (iso: string) => `${iso.slice(5, 7)}/${iso.slice(2, 4)}`;

/** A GST tax invoice for a device bill, ready for an 80 mm thermal printer. */
export function ReceiptView({ d, pharmacy }: { d: SaleDetail; pharmacy: Pharmacy | null }) {
  const s = d.sale as Record<string, string | number | null>;
  const at = new Date(String(s.at));
  return (
    <div className="receipt-print font-mono text-[12px] leading-snug text-black bg-white">
      <div className="text-center">
        <div className="text-[14px] font-bold">{pharmacy?.name ?? "Pharmacy"}</div>
        {pharmacy?.address ? <div>{pharmacy.address}</div> : null}
        {pharmacy?.phone ? <div>Ph {pharmacy.phone}</div> : null}
        {pharmacy?.gstin ? <div>GSTIN {pharmacy.gstin}</div> : null}
        {pharmacy?.dl ? <div>DL {pharmacy.dl}</div> : null}
        <div className="font-bold mt-1">TAX INVOICE</div>
      </div>
      <div className="flex justify-between mt-1"><span>{String(s.invoiceNo)}</span><span>{dayMonth(at, true)} {hhmm(at)}</span></div>
      {s.customerName ? <div>To: {String(s.customerName)}{s.customerPhone ? ` · ${s.customerPhone}` : ""}{s.customerGstin ? ` · GSTIN ${s.customerGstin}` : ""}</div> : null}
      {s.patientName ? <div>Patient: {String(s.patientName)}</div> : null}
      {s.prescriber ? <div>Dr: {String(s.prescriber)}{s.prescriberReg ? ` (Reg ${s.prescriberReg})` : ""}</div> : null}
      <div className="border-t border-dashed border-black my-1" />
      {d.lines.map((l) => (
        <div key={l.id} className="mb-0.5">
          <div>{l.name}</div>
          <div className="flex justify-between"><span>{l.qty} {l.loose ? l.looseUnit : l.packUnit} × {inr(l.mrpPaise)} · B {l.batchNo} · Exp {exp(l.expiryDate)} · {l.gstRate}%</span><span>{inr(l.mrpPaise * l.qty - l.discountPaise)}</span></div>
        </div>
      ))}
      <div className="border-t border-dashed border-black my-1" />
      <div className="flex justify-between"><span>MRP total</span><span>{inr(Number(s.subtotalPaise))}</span></div>
      {Number(s.discountPaise) ? <div className="flex justify-between"><span>Discount</span><span>−{inr(Number(s.discountPaise))}</span></div> : null}
      <div className="flex justify-between"><span>Taxable</span><span>{inr(Number(s.taxablePaise))}</span></div>
      {Number(s.igstPaise) ? <div className="flex justify-between"><span>IGST</span><span>{inr(Number(s.igstPaise))}</span></div> : <>
        <div className="flex justify-between"><span>CGST</span><span>{inr(Number(s.cgstPaise))}</span></div>
        <div className="flex justify-between"><span>SGST</span><span>{inr(Number(s.sgstPaise))}</span></div>
      </>}
      {Number(s.roundOffPaise) ? <div className="flex justify-between"><span>Round off</span><span>{inr(Number(s.roundOffPaise))}</span></div> : null}
      <div className="flex justify-between font-bold text-[14px]"><span>TOTAL</span><span>{inr(Number(s.totalPaise))}</span></div>
      <div>Paid: {d.payments.map((p) => `${p.mode.toUpperCase()} ${inr(p.amountPaise)}`).join(" + ")}</div>
      {d.returns.map((r) => <div key={r.id}>Credit note {r.creditNoteNo}: −{inr(r.amountPaise)} ({r.refundMode})</div>)}
      <div className="text-center mt-2">Prices include GST. Get well soon.</div>
    </div>
  );
}

export function printReceipt() {
  document.body.classList.add("printing-receipt");
  const done = () => { document.body.classList.remove("printing-receipt"); window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  window.print();
}

export function ReceiptModal({ d, pharmacy, onClose, autoPrint = false }: { d: SaleDetail | null; pharmacy: Pharmacy | null; onClose: () => void; autoPrint?: boolean }) {
  useEffect(() => { if (d && autoPrint) setTimeout(printReceipt, 50); }, [d, autoPrint]);
  const wa = d ? waLink(d.sale.customerPhone as string | null, billText(d, pharmacy)) : null;
  return (
    <Modal open={!!d} onClose={onClose} title={d ? `Bill ${String(d.sale.invoiceNo)}` : ""} width={420}
      footer={<div className="flex gap-2 justify-end"><Button onClick={onClose}>Close</Button>{wa && <Button onClick={() => window.open(wa, "_blank", "noopener")}><MessageCircle size={16} /> WhatsApp</Button>}<Button variant="primary" onClick={printReceipt}><Printer size={16} /> Print</Button></div>}>
      {d ? <div className="border border-line rounded-lg p-3"><ReceiptView d={d} pharmacy={pharmacy} /></div> : null}
    </Modal>
  );
}
