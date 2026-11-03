"use client";
import { useEffect, useRef, useState } from "react";
import QRCode from "qrcode";
import { CircleCheck, FileCheck2, MessageCircle, Printer, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";
import { inr } from "@/lib/money";
import { dayMonth, hhmm } from "@/lib/dates";
import type { SaleDetail } from "@/drivedb/reports";
import type { Pharmacy } from "@/drivedb/seed";
import { billForSend, billText, waLink } from "@/drivedb/share";
import { deviceDb } from "@/drivedb/device";
import { useToast } from "@/components/ui/toast";
import { useT } from "@/lib/i18n-client";
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

/** A GST tax invoice for a device bill, ready for an 80 mm thermal printer. Stays in English: it is a legal document. */
export function ReceiptView({ d, pharmacy }: { d: SaleDetail; pharmacy: Pharmacy | null }) {
  const s = d.sale as Record<string, string | number | null>;
  const at = new Date(String(s.at));
  const num = (k: string) => Number(s[k] ?? 0);
  // GST by rate, from the lines (prices are MRP-inclusive: tax = amount − taxable).
  const slabs = new Map<number, { taxable: number; tax: number }>();
  for (const l of d.lines) {
    const amt = l.mrpPaise * l.qty - l.discountPaise, x = slabs.get(l.gstRate) ?? { taxable: 0, tax: 0 };
    slabs.set(l.gstRate, { taxable: x.taxable + l.taxablePaise, tax: x.tax + amt - l.taxablePaise });
  }
  const units = d.lines.reduce((n, l) => n + l.qty, 0);
  const Row = ({ k, v, b }: { k: React.ReactNode; v: React.ReactNode; b?: boolean }) => (
    <div className={`flex justify-between gap-3 ${b ? "font-bold" : ""}`}><span>{k}</span><span className="tabular-nums whitespace-nowrap">{v}</span></div>
  );
  const Rule = ({ solid }: { solid?: boolean }) => <div className={`my-1.5 border-t border-black ${solid ? "" : "border-dashed"}`} />;
  return (
    <div className="receipt-print font-sans text-[11.5px] leading-[1.45] text-black bg-white tabular-nums">
      {/* Seller */}
      <div className="text-center">
        <div className="text-[16px] font-bold tracking-[.01em] leading-tight">{pharmacy?.name ?? "Pharmacy"}</div>
        {pharmacy?.address ? <div className="mt-0.5">{pharmacy.address}</div> : null}
        {pharmacy?.phone ? <div>Phone: {pharmacy.phone}</div> : null}
        {(pharmacy?.gstin || pharmacy?.dl) ? (
          <div className="text-[10.5px]">{[pharmacy?.gstin ? `GSTIN: ${pharmacy.gstin}` : "", pharmacy?.dl ? `DL: ${pharmacy.dl}` : ""].filter(Boolean).join("  |  ")}</div>
        ) : null}
      </div>
      <div className="my-2 border-y border-black py-0.5 text-center text-[12px] font-bold tracking-[.18em]">TAX INVOICE</div>

      {/* Bill details */}
      <div className="grid grid-cols-[auto_1fr] gap-x-2">
        <span>Bill No</span><span className="text-right font-bold">{String(s.invoiceNo)}</span>
        <span>Date</span><span className="text-right">{dayMonth(at, true)}, {hhmm(at)}</span>
        {s.customerName ? <><span>Customer</span><span className="text-right">{String(s.customerName)}</span></> : <><span>Customer</span><span className="text-right">Walk-in</span></>}
        {s.customerPhone ? <><span>Mobile</span><span className="text-right">+91 {String(s.customerPhone)}</span></> : null}
        {s.customerGstin ? <><span>GSTIN</span><span className="text-right">{String(s.customerGstin)}</span></> : null}
        {s.patientName ? <><span>Patient</span><span className="text-right">{String(s.patientName)}</span></> : null}
        {s.prescriber ? <><span>Doctor</span><span className="text-right">Dr {String(s.prescriber)}{s.prescriberReg ? ` (Reg ${s.prescriberReg})` : ""}</span></> : null}
      </div>

      {/* Items */}
      <Rule solid />
      <div className="grid grid-cols-[1fr_28px_54px_62px] gap-x-1 text-[10.5px] font-bold uppercase">
        <span>Item</span><span className="text-right">Qty</span><span className="text-right">Rate</span><span className="text-right">Amount</span>
      </div>
      <Rule />
      {d.lines.map((l) => (
        <div key={l.id} className="mb-1.5">
          <div className="grid grid-cols-[1fr_28px_54px_62px] gap-x-1">
            <span className="font-semibold break-words">{l.name}</span>
            <span className="text-right">{l.qty}</span>
            <span className="text-right">{inr(l.mrpPaise)}</span>
            <span className="text-right font-semibold">{inr(l.mrpPaise * l.qty - l.discountPaise)}</span>
          </div>
          <div className="text-[10px] text-black/80">
            {l.loose ? l.looseUnit : l.packUnit} · Batch {l.batchNo} · Exp {exp(l.expiryDate)}{l.hsn ? ` · HSN ${l.hsn}` : ""} · GST {l.gstRate}%
          </div>
        </div>
      ))}
      <Rule />
      <Row k={`Items ${d.lines.length} · Qty ${units}`} v="" />

      {/* Totals */}
      <Row k="MRP total" v={inr(num("subtotalPaise"))} />
      {num("discountPaise") ? <Row k="Discount" v={`−${inr(num("discountPaise"))}`} /> : null}
      <Row k="Taxable value" v={inr(num("taxablePaise"))} />
      {num("igstPaise") ? <Row k="IGST" v={inr(num("igstPaise"))} /> : <>
        <Row k="CGST" v={inr(num("cgstPaise"))} />
        <Row k="SGST" v={inr(num("sgstPaise"))} />
      </>}
      {num("roundOffPaise") ? <Row k="Round off" v={inr(num("roundOffPaise"))} /> : null}
      <div className="my-1.5 border-y-2 border-black py-1 flex justify-between items-baseline">
        <span className="text-[13px] font-bold">TOTAL</span><span className="text-[17px] font-bold">{inr(num("totalPaise"))}</span>
      </div>
      <Row k="Paid" v={d.payments.map((p) => `${p.mode.toUpperCase()} ${inr(p.amountPaise)}`).join(" + ")} />
      {num("discountPaise") ? <div className="mt-1 text-center font-bold">You saved {inr(num("discountPaise"))} on this bill</div> : null}
      {d.returns.map((r) => <Row key={r.id} k={`Credit note ${r.creditNoteNo} (${r.refundMode})`} v={`−${inr(r.amountPaise)}`} />)}

      {/* GST by rate */}
      {slabs.size > 0 ? (
        <>
          <Rule />
          <div className="grid grid-cols-[1fr_1fr_1fr] text-[10px]">
            <span className="font-bold">GST %</span><span className="text-right font-bold">Taxable</span><span className="text-right font-bold">Tax</span>
            {[...slabs].sort(([a], [b]) => a - b).map(([rate, v]) => (
              <span key={rate} className="contents"><span>{rate}%</span><span className="text-right">{inr(v.taxable)}</span><span className="text-right">{inr(v.tax)}</span></span>
            ))}
          </div>
        </>
      ) : null}

      {d.einvoice && !d.einvoice.cancelled ? (
        <div className="border-t border-dashed border-black mt-1.5 pt-1 text-[10px] break-all" data-testid="irn">
          <div>IRN {d.einvoice.irn}</div>
          {d.einvoice.ackNo ? <div>Ack {d.einvoice.ackNo}{d.einvoice.ackDt ? ` · ${d.einvoice.ackDt}` : ""}</div> : null}
          {d.einvoice.signedQr ? <IrnQr text={d.einvoice.signedQr} /> : null}
        </div>
      ) : d.einvoice?.cancelled ? <div className="text-[10px] mt-1">E-invoice cancelled</div> : null}

      <Rule />
      <div className="text-center">
        <div className="font-semibold">Thank you! Get well soon.</div>
        <div className="text-[10px]">Prices include GST. Check medicines and expiry before leaving the counter.</div>
      </div>
    </div>
  );
}

export function printReceipt() {
  document.body.classList.add("printing-receipt");
  const done = () => { document.body.classList.remove("printing-receipt"); window.removeEventListener("afterprint", done); };
  window.addEventListener("afterprint", done);
  window.print();
}

/** sendWhatsApp: the counter asked to send this bill on WhatsApp. With WhatsApp connected the PDF goes on opening;
 *  otherwise the receipt points to the WhatsApp share button. */
export function ReceiptModal({ d: given, pharmacy, onClose, autoPrint = false, who, sendWhatsApp = false }: { d: SaleDetail | null; pharmacy: Pharmacy | null; onClose: () => void; autoPrint?: boolean; who?: Who; sendWhatsApp?: boolean }) {
  const toast = useToast();
  const t = useT();
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
        const address = prompt(t("Billing address of {name} (as on their GST registration):", { name: String(d.sale.customerName) }));
        const pin = address ? prompt(t("6-digit PIN code:")) : null;
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
      const remark = prompt(t("Cancel this e-invoice on the GST portal? Enter a reason (e.g. order cancelled):"));
      if (!remark || remark.trim().length < 3) return;
      setBusy(true);
      const r = await ein.cancel({ irn, reason: "3", remark: remark.trim() });
      if (!r.ok) throw new Error(r.error);
      await dev.call("recordIrnCancel", id, r.data.reason, who.userId);
      await reload();
      toast("E-invoice cancelled.", "green");
    } catch (e) { toast(errText(e), "red"); } finally { setBusy(false); }
  };
  /** Sends the bill's PDF through the pharmacy's WhatsApp (via Medoro, which keeps nothing). */
  const sendPdf = async () => {
    if (!who?.whatsapp || !d) return;
    const phone = (d.sale.customerPhone as string | null) || prompt(t("Customer’s WhatsApp number (10 digits):"))?.trim();
    if (!phone) return;
    setBusy(true);
    try {
      const r = await who.whatsapp.send(billForSend(d, phone, crypto.randomUUID().replace(/-/g, "")));
      if (!r.ok) throw new Error(r.error);
      if (r.data.messageId) await dev.call("logMessage", { kind: "bill", refId: id, customerId: (d.sale.customerId as string | null) ?? null, messageId: r.data.messageId });
      void loadSent();
      toast(who.whatsapp.via === "phone" ? "Bill PDF sent from your linked WhatsApp." : "Bill PDF sent on WhatsApp.", "green");
    } catch (e) { toast(errText(e), "red"); } finally { setBusy(false); }
  };
  // Asked for at the counter: send once per bill, as soon as it opens, when the bill has the customer's number.
  const autoSent = useRef<string | null>(null);
  useEffect(() => {
    if (!sendWhatsApp || !given || !who?.whatsapp || !given.sale.customerPhone || autoSent.current === id) return;
    autoSent.current = id;
    void sendPdf();
  }, [sendWhatsApp, given, id]); // eslint-disable-line react-hooks/exhaustive-deps
  // This bill's WhatsApp sends and how far the latest got (updated by the counter's minute check).
  const [sent, setSent] = useState<{ status: string; error: string | null; sentAt: string }[]>([]);
  const loadSent = async () => { if (id) setSent(await dev.call("billMessages", id).catch(() => [])); };
  useEffect(() => { void loadSent(); }, [id]); // eslint-disable-line react-hooks/exhaustive-deps
  const b2b = !!d?.sale.customerGstin;
  const close = () => { setFresh(null); onClose(); };
  const sale = d?.sale as Record<string, string | number | null> | undefined;
  const at = sale ? new Date(String(sale.at)) : null;
  const phone = (sale?.customerPhone as string | null) ?? null;
  const last = sent[0];
  const STATUS: Record<string, [string, string]> = {
    sent: ["Sent", "bg-chip text-ink-2"], delivered: ["Delivered", "bg-teal-soft text-teal"], read: ["Read", "bg-ok-bg text-ok"], failed: ["Not delivered", "bg-bad-bg text-bad"],
  };
  return (
    <Modal open={!!d} onClose={close} title={d ? `Bill ${String(d.sale.invoiceNo)}` : ""} width={460}
      sub={at ? `${dayMonth(at, true)} · ${hhmm(at)}` : undefined}
      footer={<div className="flex w-full items-center gap-2 flex-wrap">
        <Button variant="ghost" onClick={close}>Close</Button>
        <span className="flex-1" />
        {ein && b2b && !d?.einvoice && <Button onClick={getIrn} disabled={busy}><FileCheck2 size={16} /> {busy ? t("Getting IRN…") : t("E-invoice")}</Button>}
        {ein && d?.einvoice && !d.einvoice.cancelled && <Button variant="danger-outline" onClick={cancelIrn} disabled={busy}>Cancel e-invoice</Button>}
        <Button variant="primary" size="lg" onClick={printReceipt}><Printer size={17} /> {t("Print")}</Button>
      </div>}>
      {d && sale ? (
        <div className="flex flex-col gap-4">
          {/* What was billed, at a glance. */}
          <div className="flex items-center gap-3 rounded-xl border border-[#BFE3D0] bg-ok-bg px-4 py-3">
            <CircleCheck size={26} className="text-ok shrink-0" aria-hidden />
            <div className="min-w-0 flex-1">
              <div className="text-[13px] font-medium text-ok">{t("Bill saved")}</div>
              <div className="text-[13px] text-ink-2 truncate">{sale.customerName ? `${String(sale.customerName)}${phone ? ` · +91 ${phone}` : ""}` : t("Walk-in customer")}</div>
            </div>
            <div className="text-right">
              <div className="text-[22px] font-bold leading-none tabular-nums text-ink-strong">{inr(Number(sale.totalPaise))}</div>
              <div className="mt-1 text-[11.5px] font-semibold uppercase tracking-[.05em] text-muted">{d.payments.map((p) => p.mode.toUpperCase()).join(" + ")}</div>
            </div>
          </div>

          {/* The tax invoice as it prints on the 80 mm printer. */}
          <div className="rounded-xl bg-page border border-line-soft p-3 sm:p-4">
            <div className="mx-auto w-full max-w-[320px] max-h-[44vh] overflow-auto rounded-md bg-white px-4 py-3 shadow-[0_1px_3px_rgba(16,24,40,.12)]">
              <ReceiptView d={d} pharmacy={pharmacy} />
            </div>
          </div>

          {/* Sending it to the customer. */}
          {(who?.whatsapp || wa) ? (
            <div className="rounded-xl border border-line px-4 py-3 flex flex-col gap-2.5">
              <div className="flex items-center gap-2">
                <MessageCircle size={17} className="text-ok shrink-0" aria-hidden />
                <span className="text-[14px] font-semibold">{t("WhatsApp")}</span>
                <span className="text-[13px] text-muted truncate">{phone ? `+91 ${phone}` : t("No mobile number on this bill")}</span>
                {last ? (
                  <span data-testid="wa-status" className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-semibold ${(STATUS[last.status] ?? STATUS.sent)[1]}`} title={last.error ? t(last.error) : undefined}>
                    {t((STATUS[last.status] ?? [last.status])[0])} · {hhmm(new Date(last.sentAt))}{sent.length > 1 ? ` · ×${sent.length}` : ""}
                  </span>
                ) : null}
              </div>
              {last?.error ? <div className="text-[12.5px] text-bad">{t(last.error)}</div> : null}
              {sendWhatsApp && !who?.whatsapp && wa && !last ? <div className="text-[12.5px] text-muted">{t("Send this bill to +91 {phone} on WhatsApp.", { phone: phone ?? "" })}</div> : null}
              <div className="flex gap-2 flex-wrap">
                {who?.whatsapp && <Button onClick={sendPdf} disabled={busy} className="text-ok border-[#BFE3D0] hover:bg-ok-bg"><Send size={15} /> {busy ? t("Sending…") : last ? t("Send PDF again") : t("Send PDF on WhatsApp")}</Button>}
                {wa && <Button variant={who?.whatsapp ? "ghost" : "outline"} className={who?.whatsapp ? undefined : "text-ok border-[#BFE3D0] hover:bg-ok-bg"} onClick={() => window.open(wa, "_blank", "noopener")}><MessageCircle size={15} /> {who?.whatsapp ? t("Share text") : t("Open WhatsApp")}</Button>}
              </div>
            </div>
          ) : null}
        </div>
      ) : null}
    </Modal>
  );
}
