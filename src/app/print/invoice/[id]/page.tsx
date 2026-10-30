import { notFound } from "next/navigation";
import { requireCtx } from "@/server/context";
import { invoiceData } from "@/domain/sales/service";
import { einvoiceFor } from "@/domain/gst/service";
import { stateName } from "@/domain/accounting/gst";
import { inr } from "@/lib/money";
import { monthYear } from "@/lib/dates";
import { AutoPrint } from "./auto-print";

export const metadata = { title: "Invoice" };

const fmtDate = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ format?: string }> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const { format } = await searchParams;
  const s = await invoiceData(ctx, id);
  if (!s) notFound();
  const voidNote = s.voided ? `VOID · cancelled ${fmtDate(s.voided.at)} · ${s.voided.reason}` : null;
  const e = await einvoiceFor(ctx, id);
  const igst = s.totals.igst > 0;
  const taxRows: [string, number][] = igst ? [["IGST", s.totals.igst]] : [["CGST", s.totals.cgst], ["SGST", s.totals.sgst]];
  const pos = s.placeOfSupply ? `${s.placeOfSupply} ${stateName(s.placeOfSupply)}` : null;
  const payLabel = s.payments.map((p) => `${p.mode.toUpperCase()} ${inr(p.amount)}${p.ref ? ` (${p.ref})` : ""}`).join(" + ");

  if (format === "thermal") {
    return (
      <div className="thermal">
        <style>{`@page{size:80mm auto;margin:3mm}body{background:#fff}.thermal{width:72mm;margin:0 auto;font-family:'IBM Plex Mono',monospace;font-size:11px;line-height:1.45;color:#000}.c{text-align:center}.r{display:flex;justify-content:space-between;gap:8px}.hr{border-top:1px dashed #000;margin:5px 0}@media screen{body{background:#F5F6F7}.thermal{background:#fff;padding:12px;margin-top:20px}}`}</style>
        <div className="c"><strong style={{ fontSize: 13 }}>{s.pharmacy.name.toUpperCase()}</strong></div>
        {s.pharmacy.address ? <div className="c">{s.pharmacy.address}</div> : null}
        <div className="c">{s.pharmacy.gstin ? `GSTIN ${s.pharmacy.gstin}` : ""}</div>
        {s.pharmacy.dl ? <div className="c">DL {s.pharmacy.dl}</div> : null}
        <div className="hr" />
        <div className="c"><strong>{s.voided ? "TAX INVOICE · VOID" : "TAX INVOICE"}</strong></div>
        {voidNote ? <div className="c" style={{ border: "1px solid #000", padding: 3, margin: "3px 0" }}>{voidNote}<br />Not valid for payment; fully refunded.</div> : null}
        <div className="r"><span>{s.invoiceNo}</span></div>
        <div className="r"><span>{fmtDate(s.at)}</span><span>{s.cashier}</span></div>
        <div>{s.customer?.name ?? "Walk-in customer"}</div>
        {s.customer?.gstin ? <div>GSTIN {s.customer.gstin}{pos ? ` · POS ${pos}` : ""}</div> : null}
        {s.prescriber ? <div>Dr: {s.prescriber}{s.rxNo ? ` · Rx ${s.rxNo}` : ""}</div> : null}
        <div className="hr" />
        {s.lines.map((l, i) => (
          <div key={i} style={{ marginBottom: 3 }}>
            <div>{l.name}{l.schedule ? ` [${l.schedule}]` : ""}</div>
            <div className="r"><span>{l.qtyText} × {inr(l.mrp)} · {l.batchNo} · {monthYear(l.expiry)}</span><span>{inr(l.amount)}</span></div>
          </div>
        ))}
        <div className="hr" />
        {[["MRP total", s.totals.mrp], ["Discount", -s.totals.discount], ["Taxable value", s.totals.taxable], ...taxRows, ["Round off", s.totals.roundOff]].map(([k, v]) => (
          <div key={k as string} className="r"><span>{k}</span><span>{inr(v as number)}</span></div>
        ))}
        <div className="hr" />
        <div className="r" style={{ fontSize: 14, fontWeight: 700 }}><span>TOTAL</span><span>{inr(s.totals.total)}</span></div>
        <div className="hr" />
        <div className="c">Paid: {payLabel}</div>
        <div className="c">Prices include GST · Thank you</div>
        {s.pharmacy.grievance ? <div className="c" style={{ fontSize: 10 }}>{s.pharmacy.grievance}</div> : null}
        {e?.irn ? (
          <div className="c" style={{ marginTop: 6 }}>
            {/* eslint-disable-next-line @next/next/no-img-element -- signed QR rendered on the server as a data URL */}
            {e.qr ? <img src={e.qr} alt="E-invoice QR code" style={{ width: "40mm", height: "40mm" }} /> : null}
            <div style={{ wordBreak: "break-all", fontSize: 9 }}>IRN {e.irn}</div><div>Ack {e.ackNo} · {e.ackDt}</div>
          </div>
        ) : null}
        {e?.ewbNo ? <div className="c">E-way bill {e.ewbNo}</div> : null}
        <AutoPrint />
      </div>
    );
  }

  const gstSplit = (net: number, taxable: number) => { const tax = net - taxable, c = Math.floor(tax / 2); return igst ? [tax] : [c, tax - c]; };
  return (
    <div className="a4">
      <style>{`@page{size:A4;margin:14mm}body{background:#fff}.a4{max-width:186mm;margin:0 auto;font-size:11.5px;color:#111}.a4 table{width:100%;border-collapse:collapse}.a4 th,.a4 td{border:1px solid #bbb;padding:4px 5px;text-align:left;vertical-align:top}.a4 th{background:#f2f4f5;font-weight:600}.num{text-align:right!important;font-variant-numeric:tabular-nums}@media screen{body{background:#F5F6F7}.a4{background:#fff;padding:14mm;margin:20px auto;box-shadow:0 2px 12px rgba(0,0,0,.1)}}`}</style>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, borderBottom: "2px solid #0B5E5B", paddingBottom: 8, marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{s.pharmacy.legalName ?? s.pharmacy.name}</div>
          {s.pharmacy.address ? <div>{s.pharmacy.address}</div> : null}
          <div>{s.pharmacy.gstin ? `GSTIN ${s.pharmacy.gstin}` : "GSTIN not registered"}{s.pharmacy.dl ? ` · Drug licence ${s.pharmacy.dl}` : ""}</div>
          {s.pharmacy.pharmacist ? <div>Registered pharmacist: {s.pharmacy.pharmacist}</div> : null}
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>TAX INVOICE{s.customer?.gstin ? " (B2B)" : ""}{s.voided ? " · VOID" : ""}</div>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace" }}>{s.invoiceNo}</div>
          <div>{fmtDate(s.at)}</div>
        </div>
      </div>
      {voidNote ? <div style={{ border: "2px solid #B3261E", color: "#B3261E", padding: "6px 8px", marginBottom: 10, fontWeight: 600 }}>{voidNote}. This invoice was cancelled and fully refunded; it is not valid for payment or input credit.</div> : null}
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, marginBottom: 10 }}>
        <div><strong>Bill to:</strong> {s.customer?.name ?? "Walk-in customer"}{s.customer?.phone ? ` · ${s.customer.phone}` : ""}
          {s.customer?.gstin ? <><br />GSTIN {s.customer.gstin}{s.customer.address ? <><br />{s.customer.address}</> : null}</> : null}
          {pos ? <><br />Place of supply: {pos}</> : null}</div>
        {s.prescriber ? <div><strong>Prescriber:</strong> {s.prescriber}{s.rxNo ? ` · Rx ${s.rxNo}` : ""}</div> : null}
      </div>
      <table>
        <thead><tr><th>#</th><th>Item</th><th>HSN</th><th>Batch</th><th>Exp</th><th className="num">Qty</th><th className="num">MRP</th><th className="num">Disc</th><th className="num">Taxable</th><th className="num">GST%</th>{igst ? <th className="num">IGST</th> : <><th className="num">CGST</th><th className="num">SGST</th></>}<th className="num">Amount</th></tr></thead>
        <tbody>
          {s.lines.map((l, i) => {
            const net = l.amount - l.discount, split = gstSplit(net, l.taxable);
            return (
              <tr key={i}><td>{i + 1}</td><td>{l.name}{l.schedule ? ` (Sch. ${l.schedule})` : ""}<br /><span style={{ color: "#555" }}>{l.pack}</span></td><td>{l.hsn}</td><td>{l.batchNo}</td><td>{monthYear(l.expiry)}</td>
                <td className="num">{l.qtyText}</td><td className="num">{inr(l.mrp)}</td><td className="num">{inr(l.discount)}</td><td className="num">{inr(l.taxable)}</td><td className="num">{l.gstRate}</td>{split.map((x, j) => <td key={j} className="num">{inr(x)}</td>)}<td className="num">{inr(net)}</td></tr>
            );
          })}
        </tbody>
      </table>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
        <table style={{ width: 260 }}>
          <tbody>
            {[["MRP total", s.totals.mrp], ["Discount", -s.totals.discount], ["Taxable value", s.totals.taxable], ...taxRows, ["Round off", s.totals.roundOff]].map(([k, v]) => (
              <tr key={k as string}><td>{k}</td><td className="num">{inr(v as number)}</td></tr>
            ))}
            <tr><th>Total</th><th className="num" style={{ fontSize: 14 }}>{inr(s.totals.total)}</th></tr>
          </tbody>
        </table>
      </div>
      {e?.irn || e?.ewbNo || e?.cancelled ? (
        <div style={{ marginTop: 10, display: "flex", gap: 12, alignItems: "center", border: "1px solid #bbb", padding: 6 }}>
          {/* eslint-disable-next-line @next/next/no-img-element -- signed QR rendered on the server as a data URL */}
          {e.qr ? <img src={e.qr} alt="E-invoice QR code" style={{ width: 110, height: 110 }} /> : null}
          <div style={{ fontSize: 10.5 }}>
            {e.irn ? <><div><strong>IRN</strong> <span style={{ fontFamily: "monospace", wordBreak: "break-all" }}>{e.irn}</span></div><div>Ack no. {e.ackNo} · Ack date {e.ackDt}</div></> : null}
            {e.cancelled ? <div><strong>IRN cancelled</strong></div> : null}
            {e.ewbNo ? <div>E-way bill {e.ewbNo}{e.ewbValid ? ` · valid till ${e.ewbValid}` : ""}</div> : null}
          </div>
        </div>
      ) : null}
      <div style={{ marginTop: 10 }}>Paid by {payLabel}. Prices are MRP inclusive of GST. Billed by {s.cashier}.</div>
      {s.pharmacy.grievance ? <div style={{ marginTop: 4, color: "#555", fontSize: 10.5 }}>{s.pharmacy.grievance}</div> : null}
      <div style={{ marginTop: 28, display: "flex", justifyContent: "flex-end" }}><div style={{ borderTop: "1px solid #999", paddingTop: 4, width: 200, textAlign: "center" }}>Authorised signatory</div></div>
      <AutoPrint />
    </div>
  );
}
