import { notFound } from "next/navigation";
import { requireCtx } from "@/server/context";
import { creditNoteData } from "@/domain/sales/returns";
import { inr } from "@/lib/money";
import { AutoPrint } from "../../invoice/[id]/auto-print";

export const metadata = { title: "Credit note" };

const fmtDate = (iso: string) => new Date(iso).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });

export default async function Page({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ format?: string }> }) {
  const ctx = await requireCtx();
  const { id } = await params;
  const { format } = await searchParams;
  const n = await creditNoteData(ctx, id);
  if (!n) notFound();
  const totals: [string, number][] = [["Taxable value", n.totals.taxable], ["CGST reversed", n.totals.cgst], ["SGST reversed", n.totals.sgst]];
  const refundLine = `Refund ${inr(n.totals.total)} · ${n.refundMode}`;

  if (format === "thermal") {
    return (
      <div className="thermal">
        <style>{`@page{size:80mm auto;margin:3mm}body{background:#fff}.thermal{width:72mm;margin:0 auto;font-family:'IBM Plex Mono',monospace;font-size:11px;line-height:1.45;color:#000}.c{text-align:center}.r{display:flex;justify-content:space-between;gap:8px}.hr{border-top:1px dashed #000;margin:5px 0}@media screen{body{background:#F5F6F7}.thermal{background:#fff;padding:12px;margin-top:20px}}`}</style>
        <div className="c"><strong style={{ fontSize: 13 }}>{n.pharmacy.name.toUpperCase()}</strong></div>
        {n.pharmacy.address ? <div className="c">{n.pharmacy.address}</div> : null}
        <div className="c">{n.pharmacy.gstin ? `GSTIN ${n.pharmacy.gstin}` : ""}</div>
        <div className="hr" />
        <div className="c"><strong>CREDIT NOTE</strong></div>
        <div className="r"><span>{n.no}</span></div>
        <div>{fmtDate(n.at)}</div>
        <div>Against {n.invoiceNo} ({fmtDate(n.invoiceAt)})</div>
        <div>{n.customer?.name ?? "Walk-in customer"}</div>
        <div className="hr" />
        {n.lines.map((l, i) => (
          <div key={i} style={{ marginBottom: 3 }}>
            <div>{l.name}</div>
            <div className="r"><span>{l.qty} · {l.batchNo} · GST {l.gstRate}%{l.restocked ? "" : " · not restocked"}</span><span>{inr(l.amount)}</span></div>
          </div>
        ))}
        <div className="hr" />
        {totals.map(([k, v]) => <div key={k} className="r"><span>{k}</span><span>{inr(v)}</span></div>)}
        <div className="hr" />
        <div className="r" style={{ fontSize: 14, fontWeight: 700 }}><span>TOTAL</span><span>{inr(n.totals.total)}</span></div>
        <div className="hr" />
        <div className="c">{refundLine}</div>
        <div className="c">Reason: {n.reason}</div>
        <AutoPrint />
      </div>
    );
  }

  return (
    <div className="a4">
      <style>{`@page{size:A4;margin:14mm}body{background:#fff}.a4{max-width:186mm;margin:0 auto;font-size:11.5px;color:#111}.a4 table{width:100%;border-collapse:collapse}.a4 th,.a4 td{border:1px solid #bbb;padding:4px 5px;text-align:left;vertical-align:top}.a4 th{background:#f2f4f5;font-weight:600}.num{text-align:right!important;font-variant-numeric:tabular-nums}@media screen{body{background:#F5F6F7}.a4{background:#fff;padding:14mm;margin:20px auto;box-shadow:0 2px 12px rgba(0,0,0,.1)}}`}</style>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, borderBottom: "2px solid #0B5E5B", paddingBottom: 8, marginBottom: 10 }}>
        <div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{n.pharmacy.legalName ?? n.pharmacy.name}</div>
          {n.pharmacy.address ? <div>{n.pharmacy.address}</div> : null}
          <div>{n.pharmacy.gstin ? `GSTIN ${n.pharmacy.gstin}` : "GSTIN not registered"}{n.pharmacy.dl ? ` · Drug licence ${n.pharmacy.dl}` : ""}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 16, fontWeight: 700 }}>CREDIT NOTE</div>
          <div style={{ fontFamily: "'IBM Plex Mono',monospace" }}>{n.no}</div>
          <div>{fmtDate(n.at)}</div>
        </div>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 16, marginBottom: 10 }}>
        <div><strong>Customer:</strong> {n.customer?.name ?? "Walk-in customer"}{n.customer?.phone ? ` · ${n.customer.phone}` : ""}</div>
        <div><strong>Original invoice:</strong> {n.invoiceNo} · {fmtDate(n.invoiceAt)}</div>
      </div>
      <table>
        <thead><tr><th>#</th><th>Item</th><th>HSN</th><th>Batch</th><th className="num">Qty</th><th className="num">GST%</th><th>Condition</th><th className="num">Amount</th></tr></thead>
        <tbody>
          {n.lines.map((l, i) => (
            <tr key={i}><td>{i + 1}</td><td>{l.name}</td><td>{l.hsn}</td><td>{l.batchNo}</td><td className="num">{l.qty}</td><td className="num">{l.gstRate}</td><td>{l.restocked ? "Restocked" : "Not restocked"}</td><td className="num">{inr(l.amount)}</td></tr>
          ))}
        </tbody>
      </table>
      <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
        <table style={{ width: 260 }}>
          <tbody>
            {totals.map(([k, v]) => <tr key={k}><td>{k}</td><td className="num">{inr(v)}</td></tr>)}
            <tr><th>Total credit</th><th className="num" style={{ fontSize: 14 }}>{inr(n.totals.total)}</th></tr>
          </tbody>
        </table>
      </div>
      <div style={{ marginTop: 10 }}>{refundLine}. Reason: {n.reason}. Issued by {n.by}.</div>
      <div style={{ marginTop: 28, display: "flex", justifyContent: "flex-end" }}><div style={{ borderTop: "1px solid #999", paddingTop: 4, width: 200, textAlign: "center" }}>Authorised signatory</div></div>
      <AutoPrint />
    </div>
  );
}