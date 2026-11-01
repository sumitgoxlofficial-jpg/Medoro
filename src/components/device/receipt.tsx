"use client";
import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { Printer, MessageCircle, FileCheck2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { inr } from "@/lib/money";
import { dayMonth, hhmm } from "@/lib/dates";
import type { SaleDetail } from "@/drivedb/reports";
import type { Pharmacy } from "@/drivedb/seed";
import { billText, waLink } from "@/drivedb/share";
import { deviceDb } from "@/drivedb/device";
import { useToast } from "@/components/ui/toast";
import { errText, type Who } from "./ui";

/** The signed QR from the GST portal, as an image. */
function IrnQr({ text }: { text: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => { void QRCode.toDataURL(text, { errorCorrectionLevel: "M", margin: 1, width: 180 }).then(setSrc, () => setSrc(null)); }, [text]);
  // A data URL made on this device: nothing for next/image to optimise.
  // eslint-disable-next-line @next/next/no-img-element
  return src ? <img src={src} alt="E-invoice QR code" className="mx-auto my-1" width={140} height={140} /> : null;
}

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
      {d.einvoice && !d.einvoice.cancelled ? (
        <div className="border-t border-dashed border-black mt-1 pt-1 text-[11px] break-all" data-testid="irn">
          <div>IRN {d.einvoice.irn}</div>
          {d.einvoice.ackNo ? <div>Ack {d.einvoice.ackNo}{d.einvoice.ackDt ? ` · ${d.einvoice.ackDt}` : ""}</div> : null}
          {d.einvoice.signedQr ? <IrnQr text={d.einvoice.signedQr} /> : null}
        </div>
      ) : d.einvoice?.cancelled ? <div className="text-[11px] mt-1">E-invoice cancelled</div> : null}
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

export function ReceiptModal({ d: given, pharmacy, onClose, autoPrint = false, who }: { d: SaleDetail | null; pharmacy: Pharmacy | null; onClose: () => void; autoPrint?: boolean; who?: Who }) {
  const toast = useToast();
  const [fresh, setFresh] = useState<SaleDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const d = fresh && given && fresh.sale.id === given.sale.id ? fresh : given;
  useEffect(() => { if (given && autoPrint) setTimeout(printReceipt, 50); }, [given, autoPrint]);
  const wa = d ? waLink(d.sale.customerPhone as string | null, billText(d, pharmacy)) : null;
  const dev = deviceDb(), ein = who?.einvoice;
  const id = d ? String(d.sale.id) : "";
  const reload = async () => setFresh(await dev.call("saleDetail", id));

  /** Builds the e-invoice on this counter, gets the IRN through Medoro (nothing kept there) and saves it with the bill. */
  const getIrn = async () => {
    if (!ein || !d || !who) return;
    setBusy(true);
    try {
      let doc;
      try { doc = await dev.call("einvoiceDoc", id); }
      catch (e) {
        if (!/billing address and PIN/.test(errText(e)) || !d.sale.customerId) throw e;
        const address = prompt(`Billing address of ${d.sale.customerName} (as on their GST registration):`);
        const pin = address ? prompt("6-digit PIN code:") : null;
        if (!address || !pin) return;
        await dev.call("setBillingAddress", String(d.sale.customerId), address, pin);
        doc = await dev.call("einvoiceDoc", id);
      }
      const r = await ein.irn(doc);
      if (!r.ok) throw new Error(r.error);
      await dev.call("recordIrn", id, r.data, who.userId);
      await reload();
      toast("E-invoice generated. Print the bill with its IRN and QR.", "green");
    } catch (e) { toast(errText(e), "red"); } finally { setBusy(false); }
  };
  const cancelIrn = async () => {
    if (!ein || !d?.einvoice || !who) return;
    try {
      const irn = await dev.call("einvoiceCancelCheck", id);
      const remark = prompt("Cancel this e-invoice on the GST portal? Enter a reason (e.g. order cancelled):");
      if (!remark || remark.trim().length < 3) return;
      setBusy(true);
      const r = await ein.cancel({ irn, reason: "3", remark: remark.trim() });
      if (!r.ok) throw new Error(r.error);
      await dev.call("recordIrnCancel", id, r.data.reason, who.userId);
      await reload();
      toast("E-invoice cancelled.", "green");
    } catch (e) { toast(errText(e), "red"); } finally { setBusy(false); }
  };
  const b2b = !!d?.sale.customerGstin;
  return (
    <Modal open={!!d} onClose={() => { setFresh(null); onClose(); }} title={d ? `Bill ${String(d.sale.invoiceNo)}` : ""} width={420}
      footer={<div className="flex gap-2 justify-end flex-wrap">
        <Button onClick={() => { setFresh(null); onClose(); }}>Close</Button>
        {ein && b2b && !d?.einvoice && <Button onClick={getIrn} disabled={busy}><FileCheck2 size={16} /> {busy ? "Getting IRN…" : "E-invoice"}</Button>}
        {ein && d?.einvoice && !d.einvoice.cancelled && <Button variant="danger-outline" onClick={cancelIrn} disabled={busy}>Cancel e-invoice</Button>}
        {wa && <Button onClick={() => window.open(wa, "_blank", "noopener")}><MessageCircle size={16} /> WhatsApp</Button>}
        <Button variant="primary" onClick={printReceipt}><Printer size={16} /> Print</Button>
      </div>}>
      {d ? <div className="border border-line rounded-lg p-3"><ReceiptView d={d} pharmacy={pharmacy} /></div> : null}
    </Modal>
  );
}
